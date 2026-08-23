import { describe, expect, it } from "vitest";
import { calcularSetupPorPeca } from "../setup-por-peca";
import { ErroPrecificacao } from "../erros";
import type { ParametrosMaquinaSetupPorPeca, PedidoSetupPorPeca } from "../tipos";

// Motor COMPARTILHADO pelos 3 ModeloCalculo (SERIGRAFIA/SUBLIMACAO/
// ESTAMPAGEM_QUENTE) — testado uma vez só aqui, os 3 branches em
// precificar.ts só escolhem esta mesma função (ver golden.test.ts pro
// cenário fim-a-fim de um deles).

function pedidoValido(overrides: Partial<PedidoSetupPorPeca> = {}): PedidoSetupPorPeca {
  return {
    quantidade: 100,
    numeroSetups: 1,
    ...overrides,
  };
}

function paramsValidos(
  overrides: Partial<ParametrosMaquinaSetupPorPeca> = {}
): ParametrosMaquinaSetupPorPeca {
  return {
    custoPorSetup: 40,
    custoPorPeca: 0.5,
    custoMinimo: 60,
    ...overrides,
  };
}

describe("calcularSetupPorPeca — fórmula básica", () => {
  it("custoSetup = numeroSetups × custoPorSetup, custoVariavel = quantidade × custoPorPeca", () => {
    const resultado = calcularSetupPorPeca(
      pedidoValido({ quantidade: 200, numeroSetups: 2 }),
      paramsValidos({ custoPorSetup: 40, custoPorPeca: 0.5, custoMinimo: 0 })
    );

    // custoSetup = 2 × 40 = 80
    expect(resultado.custoSetup.toNumber()).toBeCloseTo(80, 6);
    // custoVariavel = 200 × 0,5 = 100
    expect(resultado.custoVariavel.toNumber()).toBeCloseTo(100, 6);
    // custoBase = max(0, 80+100) = 180 — custoMinimo não domina aqui
    expect(resultado.custoBase.toNumber()).toBeCloseTo(180, 6);
  });

  it("custoMinimo age como piso quando setup + variável fica abaixo dele", () => {
    const resultado = calcularSetupPorPeca(
      pedidoValido({ quantidade: 10, numeroSetups: 1 }),
      paramsValidos({ custoPorSetup: 5, custoPorPeca: 0.1, custoMinimo: 60 })
    );

    // custoSetup=5, custoVariavel=1, soma=6 — bem abaixo do piso de 60
    expect(resultado.custoSetup.toNumber()).toBeCloseTo(5, 6);
    expect(resultado.custoVariavel.toNumber()).toBeCloseTo(1, 6);
    expect(resultado.custoBase.toNumber()).toBe(60);
  });

  it("quando a soma supera o mínimo, o mínimo não interfere", () => {
    const resultado = calcularSetupPorPeca(
      pedidoValido({ quantidade: 1000, numeroSetups: 3 }),
      paramsValidos({ custoPorSetup: 40, custoPorPeca: 0.5, custoMinimo: 60 })
    );

    // custoSetup=120, custoVariavel=500, soma=620 > 60
    expect(resultado.custoBase.toNumber()).toBeCloseTo(620, 6);
  });
});

describe("calcularSetupPorPeca — rejeições (ErroPrecificacao)", () => {
  it("QUANTIDADE_INVALIDA quando a quantidade é zero ou não inteira", () => {
    const params = paramsValidos();

    try {
      calcularSetupPorPeca(pedidoValido({ quantidade: 0 }), params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("QUANTIDADE_INVALIDA");
    }
  });

  it("NUMERO_SETUPS_INVALIDO quando numeroSetups é zero, negativo ou fracionário", () => {
    const params = paramsValidos();

    try {
      calcularSetupPorPeca(pedidoValido({ numeroSetups: 0 }), params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_SETUPS_INVALIDO");
    }

    try {
      calcularSetupPorPeca(pedidoValido({ numeroSetups: 1.5 }), params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_SETUPS_INVALIDO");
    }
  });
});
