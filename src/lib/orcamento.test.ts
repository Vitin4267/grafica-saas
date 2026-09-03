import { describe, it, expect } from "vitest";
import { calcularPreco } from "./orcamento";

// Achado N1 da auditoria de abrangência (Parte 7) — antes desta função ganhar
// simplesCobraPorArea, "cobra por m²" era inferido só de o CALLER ter
// preenchido largura/altura, sem saber se o produto realmente é vendido por
// tamanho. Estes testes cobrem o comportamento novo: a área só entra na
// conta quando simplesCobraPorArea=true, nunca só por dimensão preenchida.
describe("calcularPreco", () => {
  it("sem simplesCobraPorArea (omitido) — ignora largura/altura preenchidas, cobra por peça", () => {
    const resultado = calcularPreco({
      precoBase: 45,
      quantidade: 10,
      larguraCm: 30,
      alturaCm: 40,
    });
    expect(resultado.precoUnitario).toBe(45);
    expect(resultado.precoTotal).toBe(450);
    expect(resultado.cobraPorArea).toBe(false);
  });

  it("simplesCobraPorArea=false explícito — mesmo com dimensões, preço não escala por área", () => {
    const resultado = calcularPreco({
      precoBase: 45,
      quantidade: 10,
      larguraCm: 30,
      alturaCm: 40,
      simplesCobraPorArea: false,
    });
    expect(resultado.precoUnitario).toBe(45);
    expect(resultado.precoTotal).toBe(450);
    expect(resultado.cobraPorArea).toBe(false);
    // temDimensoes continua refletindo que a dimensão foi PREENCHIDA (ainda
    // que não afete o preço) — distinção usada pela UI (CalculadoraForm) pra
    // decidir o que mostrar.
    expect(resultado.temDimensoes).toBe(true);
  });

  it("simplesCobraPorArea=true com dimensões — escala por área (m²), igual ao motor M2", () => {
    const resultado = calcularPreco({
      precoBase: 60, // R$/m²
      quantidade: 1,
      larguraCm: 300,
      alturaCm: 200,
      simplesCobraPorArea: true,
    });
    // área = 3m × 2m = 6m² -> preço = 60 × 6 = 360
    expect(resultado.areaM2).toBe(6);
    expect(resultado.precoUnitario).toBe(360);
    expect(resultado.precoTotal).toBe(360);
    expect(resultado.cobraPorArea).toBe(true);
  });

  it("simplesCobraPorArea=true SEM dimensões preenchidas — cai pra preço por peça (área=1)", () => {
    const resultado = calcularPreco({
      precoBase: 45,
      quantidade: 5,
      larguraCm: null,
      alturaCm: null,
      simplesCobraPorArea: true,
    });
    expect(resultado.precoUnitario).toBe(45);
    expect(resultado.precoTotal).toBe(225);
    expect(resultado.cobraPorArea).toBe(false);
    expect(resultado.temDimensoes).toBe(false);
  });

  it("quantidade multiplica o preço unitário já arredondado", () => {
    const resultado = calcularPreco({ precoBase: 10, quantidade: 3 });
    expect(resultado.precoUnitario).toBe(10);
    expect(resultado.precoTotal).toBe(30);
  });
});
