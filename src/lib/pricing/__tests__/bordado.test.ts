import { describe, expect, it } from "vitest";
import { calcularBordado } from "../bordado";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type { ContextoBordado, ParametrosMaquinaBordado, ParametrosTenant, PedidoBordado } from "../tipos";

// Achado A4 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// Parte 1): bordado não cabe em calcularSetupPorPeca porque lá o custo por
// peça é FIXO na máquina — em bordado o custo por peça varia com o número de
// PONTOS da arte de CADA PEDIDO. Fórmula: custoBase = custoMatrizDigitalizacao
// (1×, não escala com tiragem) + Q × (numeroPontos/1000 × custoPorMilPontos)
// + Q × custoSubstrato, com custoMinimo como piso.

function pedidoBordadoValido(overrides: Partial<PedidoBordado> = {}): PedidoBordado {
  return {
    quantidade: 10,
    numeroPontos: 5000,
    ...overrides,
  };
}

function contextoBordadoValido(overrides: Partial<ContextoBordado> = {}): ContextoBordado {
  return {
    custoSubstratoPorPeca: 15,
    ...overrides,
  };
}

function parametrosBordadoValidos(
  overrides: Partial<ParametrosMaquinaBordado> = {}
): ParametrosMaquinaBordado {
  return {
    custoPorMilPontos: 0.75,
    custoMatrizDigitalizacao: 20,
    custoMinimo: 0,
    ...overrides,
  };
}

describe("calcularBordado — fórmula básica", () => {
  it("custoBase = matriz (1×) + Q×(pontos/1000×custoPorMilPontos) + Q×substrato", () => {
    const resultado = calcularBordado(
      pedidoBordadoValido({ quantidade: 10, numeroPontos: 5000 }),
      contextoBordadoValido({ custoSubstratoPorPeca: 15 }),
      parametrosBordadoValidos({ custoPorMilPontos: 0.75, custoMatrizDigitalizacao: 20 })
    );

    // custoMatriz = 20
    // custoPontos = 10 × (5000/1000 × 0,75) = 10 × 3,75 = 37,5
    // custoSubstrato = 10 × 15 = 150
    // custoBase = 20 + 37,5 + 150 = 207,5
    expect(resultado.custoMatriz.toNumber()).toBeCloseTo(20, 6);
    expect(resultado.custoPontos.toNumber()).toBeCloseTo(37.5, 6);
    expect(resultado.custoSubstrato.toNumber()).toBeCloseTo(150, 6);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(207.5, 6);
  });

  it("custoMatrizDigitalizacao é 1× por pedido — não escala com a quantidade (mesmo princípio do clichê de etiqueta)", () => {
    const resultado1 = calcularBordado(
      pedidoBordadoValido({ quantidade: 1, numeroPontos: 1000 }),
      contextoBordadoValido({ custoSubstratoPorPeca: 0, materialFornecidoPeloCliente: true }),
      parametrosBordadoValidos({ custoPorMilPontos: 0, custoMatrizDigitalizacao: 50 })
    );
    const resultado100 = calcularBordado(
      pedidoBordadoValido({ quantidade: 100, numeroPontos: 1000 }),
      contextoBordadoValido({ custoSubstratoPorPeca: 0, materialFornecidoPeloCliente: true }),
      parametrosBordadoValidos({ custoPorMilPontos: 0, custoMatrizDigitalizacao: 50 })
    );

    // custoPorMilPontos=0 e custoSubstratoPorPeca=0 isolam a matriz — deve
    // ser idêntica em 1 peça e em 100 peças.
    expect(resultado1.custoMatriz.toNumber()).toBeCloseTo(50, 6);
    expect(resultado100.custoMatriz.toNumber()).toBeCloseTo(50, 6);
    expect(resultado1.custoBase.toNumber()).toBeCloseTo(50, 6);
    expect(resultado100.custoBase.toNumber()).toBeCloseTo(50, 6);
  });

  it("um bordado com 5× mais pontos custa 5× mais em custoPontos, mesma máquina e mesma peça", () => {
    const pequeno = calcularBordado(
      pedidoBordadoValido({ quantidade: 1, numeroPontos: 3000 }),
      contextoBordadoValido({ custoSubstratoPorPeca: 0, materialFornecidoPeloCliente: true }),
      parametrosBordadoValidos({ custoMatrizDigitalizacao: 0 })
    );
    const grande = calcularBordado(
      pedidoBordadoValido({ quantidade: 1, numeroPontos: 15000 }),
      contextoBordadoValido({ custoSubstratoPorPeca: 0, materialFornecidoPeloCliente: true }),
      parametrosBordadoValidos({ custoMatrizDigitalizacao: 0 })
    );

    expect(grande.custoPontos.toNumber()).toBeCloseTo(pequeno.custoPontos.toNumber() * 5, 6);
  });

  it("respeita o piso de custoMinimo quando a soma fica abaixo dele", () => {
    const resultado = calcularBordado(
      pedidoBordadoValido({ quantidade: 1, numeroPontos: 100 }),
      contextoBordadoValido({ custoSubstratoPorPeca: 1 }),
      parametrosBordadoValidos({ custoPorMilPontos: 0.1, custoMatrizDigitalizacao: 0, custoMinimo: 500 })
    );

    expect(resultado.custoBase.toNumber()).toBe(500);
  });

  it("materialFornecidoPeloCliente=true (achado B7) permite custoSubstratoPorPeca=0 sem erro", () => {
    const resultado = calcularBordado(
      pedidoBordadoValido(),
      contextoBordadoValido({ custoSubstratoPorPeca: 0, materialFornecidoPeloCliente: true }),
      parametrosBordadoValidos()
    );
    expect(resultado.custoSubstrato.toNumber()).toBe(0);
  });
});

describe("calcularBordado — rejeições (ErroPrecificacao)", () => {
  it("NUMERO_PONTOS_INVALIDO quando numeroPontos é zero, negativo ou fracionário", () => {
    for (const numeroPontos of [0, -10, 5.5]) {
      try {
        calcularBordado(pedidoBordadoValido({ numeroPontos }), contextoBordadoValido(), parametrosBordadoValidos());
        expect.fail("deveria ter lançado ErroPrecificacao");
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroPrecificacao);
        expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_PONTOS_INVALIDO");
      }
    }
  });

  it("CUSTO_INVALIDO quando custoSubstratoPorPeca <= 0 sem materialFornecidoPeloCliente", () => {
    try {
      calcularBordado(
        pedidoBordadoValido(),
        contextoBordadoValido({ custoSubstratoPorPeca: 0 }),
        parametrosBordadoValidos()
      );
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("CUSTO_INVALIDO");
    }
  });

  it("QUANTIDADE_INVALIDA quando a quantidade é zero ou não inteira", () => {
    try {
      calcularBordado(pedidoBordadoValido({ quantidade: 0 }), contextoBordadoValido(), parametrosBordadoValidos());
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("QUANTIDADE_INVALIDA");
    }
  });
});

describe("precificar() — BORDADO passa pelo mesmo comporPreco de todo mundo", () => {
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

  function contextoBordado(extra?: Partial<ContextoPrecificacao>): ContextoPrecificacao {
    return {
      itemGraficaId: "bone-bordado",
      modeloCalculo: "BORDADO",
      viraFolha: false,
      parametros: PARAMS,
      bordado: { custoSubstratoPorPeca: 12 },
      parametrosMaquinaBordado: {
        custoPorMilPontos: 0.75,
        custoMatrizDigitalizacao: 20,
        custoMinimo: 0,
      },
      maquinaBordadoUsada: { id: "maq-1", nome: "Tajima 6 cabeças" },
      ...extra,
    };
  }

  it("preço final reflete overhead + margem + imposto sobre o custo base (matriz + pontos + substrato)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "BORDADO",
      pedido: { quantidade: 20, numeroPontos: 8000 },
      acabamentos: [],
    };

    const resultado = precificar(pedido, contextoBordado());

    // custoMatriz = 20; custoPontos = 20×(8000/1000×0,75) = 20×6 = 120;
    // custoSubstrato = 20×12 = 240; custoBase = 20+120+240 = 380
    expect(resultado.custoDireto.toNumber()).toBeCloseTo(380, 6);
    expect(resultado.precoFinal.toNumber()).toBeGreaterThan(380);
    expect(resultado.metricas.custoMatriz).toBeCloseTo(20, 6);
    expect(resultado.metricas.custoPontos).toBeCloseTo(120, 6);
    expect(resultado.metricas.custoSubstrato).toBeCloseTo(240, 6);
    expect(resultado.metricas.maquinaBordadoUsada).toEqual({ id: "maq-1", nome: "Tajima 6 cabeças" });
  });

  it("MAQUINA_BORDADO_NAO_CONFIGURADA quando o contexto não tem bordado configurado", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "BORDADO",
      pedido: { quantidade: 20, numeroPontos: 8000 },
      acabamentos: [],
    };
    const contexto = contextoBordado();
    delete contexto.bordado;

    try {
      precificar(pedido, contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("MAQUINA_BORDADO_NAO_CONFIGURADA");
    }
  });

  it("MAQUINA_BORDADO_NAO_CONFIGURADA quando o contexto não tem parametrosMaquinaBordado", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "BORDADO",
      pedido: { quantidade: 20, numeroPontos: 8000 },
      acabamentos: [],
    };
    const contexto = contextoBordado();
    delete contexto.parametrosMaquinaBordado;

    try {
      precificar(pedido, contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("MAQUINA_BORDADO_NAO_CONFIGURADA");
    }
  });
});
