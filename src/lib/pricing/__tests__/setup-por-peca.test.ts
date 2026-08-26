import { describe, expect, it } from "vitest";
import { calcularSetupPorPeca } from "../setup-por-peca";
import { ErroPrecificacao } from "../erros";
import type {
  ContextoSetupPorPeca,
  ParametrosMaquinaSetupPorPeca,
  PedidoSetupPorPeca,
} from "../tipos";

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

// Achado A2 da auditoria de abrangência (2026-08-24): custoPorPeca em
// ParametrosMaquinaSetupPorPeca é custo de MÁQUINA, não da peça física em
// branco — custoSubstratoPorPeca (= ItemGrafica.precoCompra) cobre isso,
// mesmo padrão de ContextoDigital.
function contextoValido(overrides: Partial<ContextoSetupPorPeca> = {}): ContextoSetupPorPeca {
  return {
    custoSubstratoPorPeca: 0,
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
      contextoValido(),
      paramsValidos({ custoPorSetup: 40, custoPorPeca: 0.5, custoMinimo: 0 })
    );

    // custoSetup = 2 × 40 = 80
    expect(resultado.custoSetup.toNumber()).toBeCloseTo(80, 6);
    // custoVariavel = 200 × 0,5 = 100
    expect(resultado.custoVariavel.toNumber()).toBeCloseTo(100, 6);
    // custoBase = max(0, 80+100+0) = 180 — custoMinimo não domina aqui
    expect(resultado.custoBase.toNumber()).toBeCloseTo(180, 6);
  });

  it("custoMinimo age como piso quando setup + variável fica abaixo dele", () => {
    const resultado = calcularSetupPorPeca(
      pedidoValido({ quantidade: 10, numeroSetups: 1 }),
      contextoValido(),
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
      contextoValido(),
      paramsValidos({ custoPorSetup: 40, custoPorPeca: 0.5, custoMinimo: 60 })
    );

    // custoSetup=120, custoVariavel=500, soma=620 > 60
    expect(resultado.custoBase.toNumber()).toBeCloseTo(620, 6);
  });

  it("custoSubstrato = quantidade × custoSubstratoPorPeca, somado ao custoBase (achado A2)", () => {
    const resultado = calcularSetupPorPeca(
      pedidoValido({ quantidade: 10, numeroSetups: 1 }),
      contextoValido({ custoSubstratoPorPeca: 15 }),
      paramsValidos({ custoPorSetup: 40, custoPorPeca: 0.5, custoMinimo: 0 })
    );

    // custoSetup=40, custoVariavel=5, custoSubstrato = 10 × 15 = 150
    expect(resultado.custoSubstrato.toNumber()).toBeCloseTo(150, 6);
    // custoBase = 40 + 5 + 150 = 195 (antes da correção seria 45 — o
    // substrato da peça em branco simplesmente não entrava na conta)
    expect(resultado.custoBase.toNumber()).toBeCloseTo(195, 6);
  });

  it("custoSubstrato também conta pro piso do custoMinimo", () => {
    const resultado = calcularSetupPorPeca(
      pedidoValido({ quantidade: 5, numeroSetups: 1 }),
      contextoValido({ custoSubstratoPorPeca: 20 }),
      paramsValidos({ custoPorSetup: 5, custoPorPeca: 0.1, custoMinimo: 60 })
    );

    // custoSetup=5, custoVariavel=0.5, custoSubstrato=5×20=100, soma=105.5 > 60
    expect(resultado.custoBase.toNumber()).toBeCloseTo(105.5, 6);
  });
});

describe("calcularSetupPorPeca — rejeições (ErroPrecificacao)", () => {
  it("QUANTIDADE_INVALIDA quando a quantidade é zero ou não inteira", () => {
    const contexto = contextoValido();
    const params = paramsValidos();

    try {
      calcularSetupPorPeca(pedidoValido({ quantidade: 0 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("QUANTIDADE_INVALIDA");
    }
  });

  it("NUMERO_SETUPS_INVALIDO quando numeroSetups é zero, negativo ou fracionário", () => {
    const contexto = contextoValido();
    const params = paramsValidos();

    try {
      calcularSetupPorPeca(pedidoValido({ numeroSetups: 0 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_SETUPS_INVALIDO");
    }

    try {
      calcularSetupPorPeca(pedidoValido({ numeroSetups: 1.5 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_SETUPS_INVALIDO");
    }
  });
});
