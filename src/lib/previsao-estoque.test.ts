import { describe, it, expect } from "vitest";
import {
  calcularPrevisaoItem,
  calcularPontoDePedido,
  ordenarPorUrgencia,
  type PrevisaoMateriaPrima,
} from "./previsao-estoque";

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

describe("calcularPontoDePedido (achado A8)", () => {
  it("null quando não há consumoMedioDiario (sem histórico suficiente)", () => {
    expect(calcularPontoDePedido(50, null, 7)).toBeNull();
  });

  it("estoque de segurança + consumo médio diário × lead time", () => {
    // consumo 2/dia × lead time 7 dias = 14, + 50 de segurança = 64
    expect(calcularPontoDePedido(50, 2, 7)).toBe(64);
  });

  it("trata estoqueMinimo não cadastrado (null) como segurança zero", () => {
    // consumo 3/dia × lead time 10 dias = 30, sem estoque de segurança
    expect(calcularPontoDePedido(null, 3, 10)).toBe(30);
  });

  it("lead time maior gera ponto de pedido maior (fornecedor de importação)", () => {
    const pontoNacional = calcularPontoDePedido(0, 5, 3);
    const pontoImportado = calcularPontoDePedido(0, 5, 45);
    expect(pontoImportado).toBeGreaterThan(pontoNacional!);
    expect(pontoNacional).toBe(15);
    expect(pontoImportado).toBe(225);
  });

  it("consumo zero (mas não null) resulta só no estoque de segurança", () => {
    expect(calcularPontoDePedido(20, 0, 7)).toBe(20);
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
      leadTimeDias: 7,
      pontoDePedido: null,
      abaixoDoPontoDePedido: false,
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
