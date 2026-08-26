import { describe, expect, it } from "vitest";
import { calcularRevenda } from "../revenda";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type { ContextoRevenda, ParametrosTenant, PedidoRevenda } from "../tipos";

// Achado A12 da auditoria de abrangência (2026-08-24): ModeloCalculo.SIMPLES
// era "preço digitado, zero custo calculado" — usado também pra revenda de
// brinde/terceirização, mas sem passar por comporPreco (sem overhead/imposto/
// margem/piso automáticos, sem breakdown auditável). REVENDA corrige isso:
// custoBase = Q × custoAquisicaoUnitario (sem máquina, sem setup), passando
// pelo MESMO comporPreco de todo mundo.

function pedidoRevendaValido(overrides: Partial<PedidoRevenda> = {}): PedidoRevenda {
  return {
    quantidade: 100,
    ...overrides,
  };
}

function contextoRevendaValido(overrides: Partial<ContextoRevenda> = {}): ContextoRevenda {
  return {
    custoAquisicaoUnitario: 12,
    ...overrides,
  };
}

describe("calcularRevenda — fórmula básica", () => {
  it("custoBase = quantidade × custoAquisicaoUnitario, sem máquina e sem setup", () => {
    const resultado = calcularRevenda(
      pedidoRevendaValido({ quantidade: 50 }),
      contextoRevendaValido({ custoAquisicaoUnitario: 8.5 })
    );

    // custoAquisicaoTotal = custoBase = 50 × 8,5 = 425
    expect(resultado.custoAquisicaoTotal.toNumber()).toBeCloseTo(425, 6);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(425, 6);
  });

  it("escala linearmente com a quantidade", () => {
    const resultado1 = calcularRevenda(pedidoRevendaValido({ quantidade: 1 }), contextoRevendaValido({ custoAquisicaoUnitario: 15 }));
    const resultado10 = calcularRevenda(pedidoRevendaValido({ quantidade: 10 }), contextoRevendaValido({ custoAquisicaoUnitario: 15 }));

    expect(resultado10.custoBase.toNumber()).toBeCloseTo(resultado1.custoBase.toNumber() * 10, 6);
  });
});

describe("calcularRevenda — rejeições (ErroPrecificacao)", () => {
  it("QUANTIDADE_INVALIDA quando a quantidade é zero ou não inteira", () => {
    const contexto = contextoRevendaValido();

    try {
      calcularRevenda(pedidoRevendaValido({ quantidade: 0 }), contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("QUANTIDADE_INVALIDA");
    }
  });

  it("CUSTO_AQUISICAO_NAO_CONFIGURADO quando custoAquisicaoUnitario é <= 0 (nem orçamento nem catálogo têm um valor real)", () => {
    try {
      calcularRevenda(pedidoRevendaValido(), contextoRevendaValido({ custoAquisicaoUnitario: 0 }));
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("CUSTO_AQUISICAO_NAO_CONFIGURADO");
    }
  });
});

describe("precificar() — REVENDA passa pelo mesmo comporPreco de todo mundo (diferente de SIMPLES)", () => {
  const PARAMS: ParametrosTenant = {
    overheadPercent: 0.15,
    margemPadrao: 0.2,
    impostoPercent: 0.06,
    comissaoPercent: 0,
    taxaFinanceiraPercent: 0,
    pedidoMinimo: 0,
    incrementoArredondamento: 0.1,
    margemSegurancaPadrao: 0.02,
    gapPecasPadrao: 0.008,
  };

  function contextoRevenda(extra?: Partial<ContextoPrecificacao>): ContextoPrecificacao {
    return {
      itemGraficaId: "caneca-personalizada",
      modeloCalculo: "REVENDA",
      viraFolha: false,
      parametros: PARAMS,
      revenda: { custoAquisicaoUnitario: 10 },
      ...extra,
    };
  }

  it("preço final reflete overhead + margem + imposto sobre o custo de aquisição (nunca igual ao custo cru, ao contrário de SIMPLES)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "REVENDA",
      pedido: { quantidade: 100 },
      acabamentos: [],
    };

    const resultado = precificar(pedido, contextoRevenda());

    // custoDireto = custoBase = 100 × 10 = 1000; custoTotal = 1000 × 1,15 = 1150
    // encargos = 0,20 + 0,06 = 0,26 -> precoBruto = 1150 / (1 - 0,26) = 1554,05...
    expect(resultado.custoDireto.toNumber()).toBeCloseTo(1000, 6);
    expect(resultado.custoTotal.toNumber()).toBeCloseTo(1150, 6);
    // Preço final tem que ficar bem acima do custo cru — é exatamente o que
    // SIMPLES nunca garantia (preço digitado podia ficar abaixo do custo).
    expect(resultado.precoFinal.toNumber()).toBeGreaterThan(1000);
    expect(resultado.precoUnitario.toNumber()).toBeGreaterThan(10);

    // breakdown auditável — detalhes.overhead/margem preenchidos, nunca null
    // (SIMPLES não gera breakdown nenhum, ver orcamento-precificacao.ts).
    expect(resultado.detalhes.overhead.toNumber()).toBeCloseTo(150, 6);
    expect(resultado.detalhes.margem.toNumber()).toBeCloseTo(0.2, 6);
    expect(resultado.metricas.custoAquisicaoUnitario).toBe(10);
    expect(resultado.metricas.custoAquisicaoTotal).toBeCloseTo(1000, 6);
  });

  it("CUSTO_AQUISICAO_NAO_CONFIGURADO quando o contexto não tem revenda configurado", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "REVENDA",
      pedido: { quantidade: 100 },
      acabamentos: [],
    };
    const contexto = contextoRevenda();
    delete contexto.revenda;

    try {
      precificar(pedido, contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("CUSTO_AQUISICAO_NAO_CONFIGURADO");
    }
  });
});
