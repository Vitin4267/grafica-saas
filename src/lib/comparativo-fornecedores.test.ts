import { describe, it, expect } from "vitest";
import { chaveComparativo, montarComparativoFornecedores, type CompraBruta } from "./comparativo-fornecedores";

function compra(parcial: Partial<CompraBruta>): CompraBruta {
  return {
    itemGraficaId: "papel-couche",
    varianteId: null,
    fornecedorId: "f1",
    fornecedorNome: "Fornecedor 1",
    custoUnitario: 10,
    criadaEm: new Date("2026-08-01T12:00:00Z"),
    ...parcial,
  };
}

describe("chaveComparativo", () => {
  it("usa a variante quando ela existe", () => {
    expect(chaveComparativo("item1", "var1")).toBe("var1");
  });

  it("cai no itemGraficaId quando não há variante", () => {
    expect(chaveComparativo("item1", null)).toBe("item1");
    expect(chaveComparativo("item1", undefined)).toBe("item1");
  });
});

describe("montarComparativoFornecedores", () => {
  it("agrupa por matéria-prima e ordena fornecedores do mais barato pro mais caro", () => {
    const resultado = montarComparativoFornecedores([
      compra({ fornecedorId: "f1", fornecedorNome: "Caro Papéis", custoUnitario: 15 }),
      compra({ fornecedorId: "f2", fornecedorNome: "Barato Ltda", custoUnitario: 8 }),
    ]);

    const linhas = resultado.get("papel-couche")!;
    expect(linhas).toHaveLength(2);
    expect(linhas[0].fornecedorNome).toBe("Barato Ltda");
    expect(linhas[0].ultimoPreco).toBe(8);
    expect(linhas[1].fornecedorNome).toBe("Caro Papéis");
  });

  it("usa o preço da compra MAIS RECENTE de cada fornecedor pra ordenar, não a mais antiga", () => {
    const resultado = montarComparativoFornecedores([
      // f1: comprou caro há muito tempo, mas a última compra ficou barata
      compra({ fornecedorId: "f1", fornecedorNome: "F1", custoUnitario: 100, criadaEm: new Date("2026-01-01T00:00:00Z") }),
      compra({ fornecedorId: "f1", fornecedorNome: "F1", custoUnitario: 5, criadaEm: new Date("2026-08-01T00:00:00Z") }),
      // f2: só uma compra, preço intermediário
      compra({ fornecedorId: "f2", fornecedorNome: "F2", custoUnitario: 20, criadaEm: new Date("2026-06-01T00:00:00Z") }),
    ]);

    const linhas = resultado.get("papel-couche")!;
    expect(linhas[0].fornecedorNome).toBe("F1");
    expect(linhas[0].ultimoPreco).toBe(5);
    expect(linhas[1].fornecedorNome).toBe("F2");
  });

  it("limita o histórico por fornecedor a MAX_HISTORICO_POR_FORNECEDOR, mais recente primeiro", () => {
    const compras: CompraBruta[] = Array.from({ length: 7 }, (_, i) =>
      compra({
        custoUnitario: i,
        criadaEm: new Date(2026, 0, i + 1),
      })
    );
    const resultado = montarComparativoFornecedores(compras);
    const linhas = resultado.get("papel-couche")!;
    expect(linhas[0].historico).toHaveLength(5);
    // Mais recente primeiro: a compra do dia 7 (índice 6, preço 6) vem antes.
    expect(linhas[0].historico[0].preco).toBe(6);
    expect(linhas[0].ultimoPreco).toBe(6);
  });

  it("separa o comparativo por variante quando varianteId difere", () => {
    const resultado = montarComparativoFornecedores([
      compra({ itemGraficaId: "chapa", varianteId: "2mm", custoUnitario: 30 }),
      compra({ itemGraficaId: "chapa", varianteId: "5mm", custoUnitario: 50 }),
    ]);

    expect(resultado.get("2mm")).toHaveLength(1);
    expect(resultado.get("5mm")).toHaveLength(1);
    expect(resultado.get("chapa")).toBeUndefined();
  });

  it("retorna Map vazio quando não há compras", () => {
    const resultado = montarComparativoFornecedores([]);
    expect(resultado.size).toBe(0);
  });
});
