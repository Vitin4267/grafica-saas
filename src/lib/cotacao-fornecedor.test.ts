import { describe, it, expect } from "vitest";
import { ultimasCotacoesPorFornecedor, type CotacaoBruta } from "./cotacao-fornecedor";

function cotacao(parcial: Partial<CotacaoBruta>): CotacaoBruta {
  return {
    fornecedorId: "f1",
    fornecedorNome: "Fornecedor 1",
    precoUnitario: 5,
    condicaoPagamento: null,
    prazoEntregaDias: null,
    frete: null,
    criadaEm: new Date("2026-08-01T12:00:00Z"),
    ...parcial,
  };
}

describe("ultimasCotacoesPorFornecedor", () => {
  it("mantém só a cotação mais recente de cada fornecedor", () => {
    const resultado = ultimasCotacoesPorFornecedor([
      cotacao({ fornecedorId: "f1", precoUnitario: 5.5, criadaEm: new Date("2026-07-01T12:00:00Z") }),
      cotacao({ fornecedorId: "f1", precoUnitario: 5.2, criadaEm: new Date("2026-08-01T12:00:00Z") }), // mais recente
    ]);

    expect(resultado).toHaveLength(1);
    expect(resultado[0].precoUnitario).toBe(5.2);
  });

  it("ordena os fornecedores do mais barato pro mais caro", () => {
    const resultado = ultimasCotacoesPorFornecedor([
      cotacao({ fornecedorId: "f1", fornecedorNome: "Caro Papéis", precoUnitario: 15 }),
      cotacao({ fornecedorId: "f2", fornecedorNome: "Barato Ltda", precoUnitario: 8 }),
    ]);

    expect(resultado.map((r) => r.fornecedorNome)).toEqual(["Barato Ltda", "Caro Papéis"]);
  });

  it("lista vazia devolve lista vazia (item nunca cotado antes)", () => {
    expect(ultimasCotacoesPorFornecedor([])).toEqual([]);
  });

  it("preserva condicaoPagamento/prazoEntregaDias/frete da cotação mais recente escolhida", () => {
    const resultado = ultimasCotacoesPorFornecedor([
      cotacao({
        fornecedorId: "f1",
        precoUnitario: 5.5,
        condicaoPagamento: "à vista",
        prazoEntregaDias: 2,
        frete: 0,
        criadaEm: new Date("2026-07-01T12:00:00Z"),
      }),
      cotacao({
        fornecedorId: "f1",
        precoUnitario: 5.2,
        condicaoPagamento: "boleto 30",
        prazoEntregaDias: 10,
        frete: 50,
        criadaEm: new Date("2026-08-01T12:00:00Z"),
      }),
    ]);

    expect(resultado[0]).toMatchObject({ condicaoPagamento: "boleto 30", prazoEntregaDias: 10, frete: 50 });
  });
});
