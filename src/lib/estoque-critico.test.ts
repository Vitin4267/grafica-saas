import { describe, it, expect } from "vitest";
import { cruzouLimiteMinimo } from "./estoque-critico";

describe("cruzouLimiteMinimo", () => {
  it("detecta a transição de OK pra crítico", () => {
    expect(cruzouLimiteMinimo(15, 8, 10)).toBe(true);
  });

  it("não dispara se já estava abaixo do mínimo antes da baixa", () => {
    expect(cruzouLimiteMinimo(9, 5, 10)).toBe(false);
  });

  it("não dispara se continua acima do mínimo depois da baixa", () => {
    expect(cruzouLimiteMinimo(20, 15, 10)).toBe(false);
  });

  it("dispara quando cai exatamente no mínimo", () => {
    expect(cruzouLimiteMinimo(12, 10, 10)).toBe(true);
  });

  it("não dispara quando não há estoque mínimo cadastrado", () => {
    expect(cruzouLimiteMinimo(15, 5, null)).toBe(false);
  });

  it("não dispara se já estava exatamente no mínimo antes (não é transição)", () => {
    expect(cruzouLimiteMinimo(10, 5, 10)).toBe(false);
  });
});
