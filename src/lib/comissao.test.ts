import { describe, it, expect } from "vitest";
import { calcularValorBase, calcularComissao } from "./comissao";

describe("calcularValorBase", () => {
  it("modo VALOR usa o total do orçamento direto, ignora itens", () => {
    expect(calcularValorBase(1000, [{ precoTotal: 999, custoTotal: 1 }], "VALOR")).toBe(1000);
  });

  it("modo LUCRO soma preço - custo de cada item", () => {
    const itens = [
      { precoTotal: 500, custoTotal: 200 },
      { precoTotal: 300, custoTotal: 100 },
    ];
    expect(calcularValorBase(800, itens, "LUCRO")).toBe(500); // (500-200) + (300-100)
  });

  it("modo LUCRO com item sem custo cadastrado (custoTotal 0) conta como lucro total", () => {
    expect(calcularValorBase(200, [{ precoTotal: 200, custoTotal: 0 }], "LUCRO")).toBe(200);
  });
});

describe("calcularComissao", () => {
  it("calcula percentual simples sobre o valor-base", () => {
    expect(calcularComissao(1000, 0.05)).toBe(50);
  });

  it("nunca fica negativa mesmo com valor-base negativo (venda abaixo do custo)", () => {
    expect(calcularComissao(-100, 0.1)).toBe(0);
  });

  it("percentual zero não gera comissão", () => {
    expect(calcularComissao(1000, 0)).toBe(0);
  });
});
