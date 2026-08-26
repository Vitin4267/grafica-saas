import { describe, expect, it } from "vitest";
import { calcularQtdBase, calcularCustoAcabamento } from "../acabamento";
import type { ConfigAcabamento, ContextoAcabamento } from "../tipos";

// Achado A13 da auditoria de abrangência (2026-08-24): BaseCobranca.MILHEIRO
// e CENTO não existiam, mas são a forma universal de cobrança de acabamento
// gráfico brasileiro ("R$ X o milheiro" pra dobra, alceamento, encarte,
// aplicação). Este arquivo cobre a implementação: MILHEIRO divide quantidade
// por 1000, CENTO divide por 100.

const ACABAMENTO_MILHEIRO: ConfigAcabamento = {
  itemGraficaId: "dobra",
  nome: "Dobra",
  baseCobranca: "MILHEIRO",
  estagio: "POS_REFILE",
  custoUnitario: 50,
  custoSetup: 0,
  custoMinimo: 0,
};

const ACABAMENTO_CENTO: ConfigAcabamento = {
  itemGraficaId: "alceamento",
  nome: "Alceamento",
  baseCobranca: "CENTO",
  estagio: "POS_REFILE",
  custoUnitario: 10,
  custoSetup: 0,
  custoMinimo: 0,
};

describe("calcularQtdBase — MILHEIRO e CENTO dividem quantidade corretamente", () => {
  it("MILHEIRO com quantidade 3500: qtdBase = 3.5", () => {
    const ctx: ContextoAcabamento = {
      quantidade: 3500,
      larguraEfetivaM: 0.1,
      alturaEfetivaM: 0.1,
    };
    const qtdBase = calcularQtdBase(ACABAMENTO_MILHEIRO, ctx);
    expect(qtdBase.toNumber()).toBe(3.5);
  });

  it("CENTO com quantidade 250: qtdBase = 2.5", () => {
    const ctx: ContextoAcabamento = {
      quantidade: 250,
      larguraEfetivaM: 0.1,
      alturaEfetivaM: 0.1,
    };
    const qtdBase = calcularQtdBase(ACABAMENTO_CENTO, ctx);
    expect(qtdBase.toNumber()).toBe(2.5);
  });

  it("MILHEIRO com quantidade 1000: qtdBase = 1.0", () => {
    const ctx: ContextoAcabamento = {
      quantidade: 1000,
      larguraEfetivaM: 0.1,
      alturaEfetivaM: 0.1,
    };
    const qtdBase = calcularQtdBase(ACABAMENTO_MILHEIRO, ctx);
    expect(qtdBase.toNumber()).toBe(1);
  });

  it("CENTO com quantidade 100: qtdBase = 1.0", () => {
    const ctx: ContextoAcabamento = {
      quantidade: 100,
      larguraEfetivaM: 0.1,
      alturaEfetivaM: 0.1,
    };
    const qtdBase = calcularQtdBase(ACABAMENTO_CENTO, ctx);
    expect(qtdBase.toNumber()).toBe(1);
  });
});

describe("calcularCustoAcabamento — MILHEIRO e CENTO calculam custo correto", () => {
  it("MILHEIRO com quantidade 3500: custo = 3.5 × R$50 = R$175", () => {
    const ctx: ContextoAcabamento = {
      quantidade: 3500,
      larguraEfetivaM: 0.1,
      alturaEfetivaM: 0.1,
    };
    const custo = calcularCustoAcabamento(ACABAMENTO_MILHEIRO, ctx);
    expect(custo.toNumber()).toBe(175); // 3.5 × R$50
  });

  it("CENTO com quantidade 250: custo = 2.5 × R$10 = R$25", () => {
    const ctx: ContextoAcabamento = {
      quantidade: 250,
      larguraEfetivaM: 0.1,
      alturaEfetivaM: 0.1,
    };
    const custo = calcularCustoAcabamento(ACABAMENTO_CENTO, ctx);
    expect(custo.toNumber()).toBe(25); // 2.5 × R$10
  });
});
