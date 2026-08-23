import { describe, expect, it } from "vitest";
import { calcularDigital } from "../digital";
import { ErroPrecificacao } from "../erros";
import type { ContextoDigital, ParametrosImpressoraDigital, PedidoDigital } from "../tipos";

// Sem nesting (ver comentário em tipos.ts) — o custo é direto: cliques ×
// custo por clique + substrato consumido por peça. Nada de bobina/formato
// pra resolver aqui, então as fixtures são bem mais simples que as de
// flexografia.test.ts/etiqueta-cliche.test.ts.

function pedidoDigitalValido(overrides: Partial<PedidoDigital> = {}): PedidoDigital {
  return {
    quantidade: 100,
    ...overrides,
  };
}

function contextoDigitalValido(overrides: Partial<ContextoDigital> = {}): ContextoDigital {
  return {
    custoSubstratoPorPeca: 0.5,
    ...overrides,
  };
}

function paramsImpressoraValidos(
  overrides: Partial<ParametrosImpressoraDigital> = {}
): ParametrosImpressoraDigital {
  return {
    custoPorClique: 0.08,
    ...overrides,
  };
}

describe("calcularDigital — fórmula básica", () => {
  it("custoCliques = quantidade × numeroCliques × custoPorClique, custoSubstrato = quantidade × custoSubstratoPorPeca", () => {
    const resultado = calcularDigital(
      pedidoDigitalValido({ quantidade: 100, numeroCliques: 2 }),
      contextoDigitalValido({ custoSubstratoPorPeca: 0.5 }),
      paramsImpressoraValidos({ custoPorClique: 0.08 })
    );

    // custoCliques = 100 × 2 × 0,08 = 16
    expect(resultado.custoCliques.toNumber()).toBeCloseTo(16, 6);
    // custoSubstrato = 100 × 0,5 = 50
    expect(resultado.custoSubstrato.toNumber()).toBeCloseTo(50, 6);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(66, 6);
    expect(resultado.numeroCliques).toBe(2);
  });

  it("numeroCliques ausente usa o default de 1 clique por peça", () => {
    const resultado = calcularDigital(
      pedidoDigitalValido({ quantidade: 50 }), // sem numeroCliques
      contextoDigitalValido({ custoSubstratoPorPeca: 1 }),
      paramsImpressoraValidos({ custoPorClique: 0.1 })
    );

    expect(resultado.numeroCliques).toBe(1);
    // custoCliques = 50 × 1 × 0,1 = 5
    expect(resultado.custoCliques.toNumber()).toBeCloseTo(5, 6);
    expect(resultado.custoSubstrato.toNumber()).toBeCloseTo(50, 6);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(55, 6);
  });

  it("um default customizado (numeroCliquesPadrao) substitui o default embutido de 1", () => {
    const resultado = calcularDigital(
      pedidoDigitalValido({ quantidade: 10 }),
      contextoDigitalValido({ custoSubstratoPorPeca: 0.01 }),
      paramsImpressoraValidos({ custoPorClique: 1 }),
      { numeroCliquesPadrao: 4 }
    );

    expect(resultado.numeroCliques).toBe(4);
    expect(resultado.custoCliques.toNumber()).toBeCloseTo(40, 6);
  });
});

describe("calcularDigital — rejeições (ErroPrecificacao)", () => {
  it("QUANTIDADE_INVALIDA quando a quantidade é zero ou não inteira", () => {
    const contexto = contextoDigitalValido();
    const params = paramsImpressoraValidos();

    expect(() => calcularDigital(pedidoDigitalValido({ quantidade: 0 }), contexto, params)).toThrow(
      ErroPrecificacao
    );
    try {
      calcularDigital(pedidoDigitalValido({ quantidade: 0 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("QUANTIDADE_INVALIDA");
    }
  });

  it("NUMERO_CLIQUES_INVALIDO quando numeroCliques é informado mas é zero ou fracionário", () => {
    const contexto = contextoDigitalValido();
    const params = paramsImpressoraValidos();

    try {
      calcularDigital(pedidoDigitalValido({ numeroCliques: 0 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_CLIQUES_INVALIDO");
    }

    try {
      calcularDigital(pedidoDigitalValido({ numeroCliques: 1.5 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_CLIQUES_INVALIDO");
    }
  });

  it("CUSTO_INVALIDO quando o substrato não tem preço de compra cadastrado (<= 0)", () => {
    const params = paramsImpressoraValidos();

    try {
      calcularDigital(
        pedidoDigitalValido(),
        contextoDigitalValido({ custoSubstratoPorPeca: 0 }),
        params
      );
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("CUSTO_INVALIDO");
    }
  });
});
