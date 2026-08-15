import { describe, it, expect } from "vitest";
import { calcularPrevisaoItem, ordenarPorUrgencia, type PrevisaoMateriaPrima } from "./previsao-estoque";

const AGORA = new Date("2026-07-11T00:00:00Z");

describe("calcularPrevisaoItem", () => {
  it("retorna sem dados quando há menos de 2 movimentações", () => {
    const resultado = calcularPrevisaoItem(
      100,
      [{ quantidade: 10, createdAt: new Date("2026-07-05T00:00:00Z") }],
      AGORA
    );
    expect(resultado.diasRestantes).toBeNull();
    expect(resultado.consumoMedioDiario).toBeNull();
  });

  it("calcula consumo médio e dias restantes a partir do histórico", () => {
    // 20 unidades consumidas em 10 dias = 2/dia; estoque de 100 -> 50 dias restantes
    const resultado = calcularPrevisaoItem(
      100,
      [
        { quantidade: 10, createdAt: new Date("2026-07-01T00:00:00Z") },
        { quantidade: 10, createdAt: new Date("2026-07-06T00:00:00Z") },
      ],
      AGORA
    );
    expect(resultado.consumoMedioDiario).toBeCloseTo(2, 5);
    expect(resultado.diasRestantes).toBeCloseTo(50, 5);
    expect(resultado.dataPrevistaEsgotamento).not.toBeNull();
  });

  it("não gera previsão quando o consumo total no período é zero", () => {
    const resultado = calcularPrevisaoItem(
      100,
      [
        { quantidade: 0, createdAt: new Date("2026-07-01T00:00:00Z") },
        { quantidade: 0, createdAt: new Date("2026-07-06T00:00:00Z") },
      ],
      AGORA
    );
    expect(resultado.diasRestantes).toBeNull();
  });
});

describe("ordenarPorUrgencia", () => {
  function item(parcial: Partial<PrevisaoMateriaPrima>): PrevisaoMateriaPrima {
    return {
      id: "x",
      nome: "Item",
      categoria: "Cat",
      unidade: "KG",
      estoqueAtual: 10,
      estoqueMinimo: null,
      abaixoDoMinimo: false,
      quantidadePorEmbalagem: null,
      consumoMedioDiario: null,
      diasRestantes: null,
      dataPrevistaEsgotamento: null,
      ...parcial,
    };
  }

  it("prioriza previsão disponível, ordenada por urgência crescente", () => {
    const itens = [
      item({ id: "longe", diasRestantes: 90 }),
      item({ id: "perto", diasRestantes: 5 }),
      item({ id: "sem-previsao-abaixo-minimo", abaixoDoMinimo: true }),
      item({ id: "sem-nada" }),
    ];
    const ordenado = ordenarPorUrgencia(itens).map((i) => i.id);
    expect(ordenado).toEqual(["perto", "longe", "sem-previsao-abaixo-minimo", "sem-nada"]);
  });
});
