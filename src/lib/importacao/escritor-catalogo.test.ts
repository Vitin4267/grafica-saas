import { describe, it, expect } from "vitest";
import { catalogoImportacaoSchema, normalizarTipoItem, normalizarUnidade } from "./escritor-catalogo";

describe("catalogoImportacaoSchema", () => {
  it("aceita linha só com nome — categoria vira 'Importado'", () => {
    const resultado = catalogoImportacaoSchema.safeParse({ nome: "Cartão de visita" });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.categoria).toBe("Importado");
  });

  it("rejeita nome ausente/curto demais", () => {
    expect(catalogoImportacaoSchema.safeParse({}).success).toBe(false);
    expect(catalogoImportacaoSchema.safeParse({ nome: "A" }).success).toBe(false);
  });

  it("preserva categoria informada em vez do default", () => {
    const resultado = catalogoImportacaoSchema.safeParse({ nome: "Banner", categoria: "Grande formato" });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.categoria).toBe("Grande formato");
  });

  it("descricao/ncm vazios viram undefined, não string vazia", () => {
    const resultado = catalogoImportacaoSchema.safeParse({ nome: "Banner", descricao: "", ncm: "" });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.descricao).toBeUndefined();
      expect(resultado.data.ncm).toBeUndefined();
    }
  });

  it.each([
    ["1.234,56", 1234.56],
    ["R$ 99,90", 99.9],
    ["", undefined],
  ])("precoVenda '%s' -> %s (reusa parseNumeroBrasileiro)", (entrada, esperado) => {
    const resultado = catalogoImportacaoSchema.safeParse({ nome: "Banner", precoVenda: entrada });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.precoVenda).toBe(esperado);
  });

  it("precoCompra/estoqueAtual ausentes viram undefined (não força zero)", () => {
    const resultado = catalogoImportacaoSchema.safeParse({ nome: "Banner" });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.precoCompra).toBeUndefined();
      expect(resultado.data.estoqueAtual).toBeUndefined();
    }
  });
});

describe("normalizarTipoItem", () => {
  it.each([
    [undefined, "PRODUTO"],
    ["", "PRODUTO"],
    ["Produto", "PRODUTO"],
    ["Serviço", "SERVICO"],
    ["serviço de acabamento", "SERVICO"],
    ["Matéria-prima", "MATERIA_PRIMA"],
    ["insumo", "MATERIA_PRIMA"],
    ["papel (matéria prima)", "MATERIA_PRIMA"],
    ["qualquer coisa não reconhecida", "PRODUTO"],
  ])("%s -> %s", (entrada, esperado) => {
    expect(normalizarTipoItem(entrada)).toBe(esperado);
  });
});

describe("normalizarUnidade", () => {
  it("ausente/vazio -> unidade e unidadeOutro undefined", () => {
    expect(normalizarUnidade(undefined)).toEqual({ unidade: undefined, unidadeOutro: undefined });
    expect(normalizarUnidade("   ")).toEqual({ unidade: undefined, unidadeOutro: undefined });
  });

  it.each([
    ["un", "UNIDADE"],
    ["unidade", "UNIDADE"],
    ["m2", "METRO_QUADRADO"],
    ["metro quadrado", "METRO_QUADRADO"],
    ["kg", "KG"],
    ["quilo", "KG"],
    ["folha", "FOLHA"],
    ["rolo", "ROLO"],
    ["pacote", "PACOTE"],
    ["cento", "CENTO"],
    ["milheiro", "MILHEIRO"],
    ["litro", "LITRO"],
    ["hora", "HORA"],
  ])("'%s' -> %s", (entrada, esperado) => {
    expect(normalizarUnidade(entrada)).toEqual({ unidade: esperado, unidadeOutro: undefined });
  });

  it("texto não reconhecido vira OUTRO + unidadeOutro truncado a 40 chars", () => {
    const textoLongo = "a".repeat(60);
    const resultado = normalizarUnidade(textoLongo);
    expect(resultado.unidade).toBe("OUTRO");
    expect(resultado.unidadeOutro).toHaveLength(40);
    expect(resultado.unidadeOutro).toBe("a".repeat(40));
  });

  it("resma (unidade real fora da lista fechada) vira OUTRO com o texto original", () => {
    expect(normalizarUnidade("resma")).toEqual({ unidade: "OUTRO", unidadeOutro: "resma" });
  });
});
