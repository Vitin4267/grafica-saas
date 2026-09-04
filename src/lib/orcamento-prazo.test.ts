import { describe, it, expect } from "vitest";
import { calcularPrazoEfetivoDias } from "./orcamento-prazo";

describe("calcularPrazoEfetivoDias (achado B4)", () => {
  it("sem cabeçalho e sem nenhum item preenchido — null (comportamento de hoje)", () => {
    expect(calcularPrazoEfetivoDias(null, [{ prazoEstimadoDias: null }])).toBeNull();
    expect(calcularPrazoEfetivoDias(null, [])).toBeNull();
  });

  it("só cabeçalho preenchido, nenhum item — devolve o cabeçalho (comportamento de hoje)", () => {
    expect(calcularPrazoEfetivoDias(5, [{ prazoEstimadoDias: null }])).toBe(5);
  });

  it("item com prazo maior que o cabeçalho — cabeçalho reflete o maior", () => {
    expect(calcularPrazoEfetivoDias(2, [{ prazoEstimadoDias: 20 }])).toBe(20);
  });

  it("item com prazo menor que o cabeçalho — nunca sub-promete, mantém o do cabeçalho", () => {
    expect(calcularPrazoEfetivoDias(20, [{ prazoEstimadoDias: 2 }])).toBe(20);
  });

  it("múltiplos itens — usa o maior entre todos", () => {
    expect(
      calcularPrazoEfetivoDias(null, [
        { prazoEstimadoDias: 2 },
        { prazoEstimadoDias: 20 },
        { prazoEstimadoDias: null },
        { prazoEstimadoDias: 10 },
      ])
    ).toBe(20);
  });

  it("sem cabeçalho, só item preenchido — usa o item", () => {
    expect(calcularPrazoEfetivoDias(null, [{ prazoEstimadoDias: 7 }])).toBe(7);
  });
});
