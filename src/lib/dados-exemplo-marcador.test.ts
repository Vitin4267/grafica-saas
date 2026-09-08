import { describe, it, expect } from "vitest";
import { PREFIXO_EXEMPLO, ehDadoDeExemplo } from "@/lib/dados-exemplo-marcador";

describe("ehDadoDeExemplo", () => {
  it("reconhece um nome com o prefixo de exemplo", () => {
    expect(ehDadoDeExemplo(`${PREFIXO_EXEMPLO}Cartão de Visita`)).toBe(true);
  });

  it("reconhece o prefixo mesmo sozinho (sem resto do nome)", () => {
    expect(ehDadoDeExemplo(PREFIXO_EXEMPLO)).toBe(true);
  });

  it("rejeita um nome real sem o prefixo", () => {
    expect(ehDadoDeExemplo("Cartão de Visita")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(ehDadoDeExemplo("")).toBe(false);
  });

  it("não confunde o prefixo aparecendo no MEIO do nome com o prefixo no início", () => {
    expect(ehDadoDeExemplo(`Cliente ${PREFIXO_EXEMPLO}Fake`)).toBe(false);
  });

  it("é sensível a maiúsculas/minúsculas (mesma marcação exata usada em dados-exemplo.ts)", () => {
    expect(ehDadoDeExemplo("[exemplo] Cartão de Visita")).toBe(false);
  });
});
