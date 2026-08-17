import { describe, it, expect } from "vitest";
import { pedidoImportacaoSchema } from "./escritor-pedidos";

const linhaValida = {
  clienteNome: "Fulano de Tal",
  produtoDescricao: "1000 cartões de visita 4x4",
  valorTotal: "250,00",
  data: "15/03/2026",
};

describe("pedidoImportacaoSchema", () => {
  it("aceita a linha mínima obrigatória", () => {
    const resultado = pedidoImportacaoSchema.safeParse(linhaValida);
    expect(resultado.success).toBe(true);
  });

  it.each(["clienteNome", "produtoDescricao", "valorTotal", "data"] as const)(
    "rejeita quando falta o campo obrigatório %s",
    (campo) => {
      const { [campo]: _omitido, ...linhaSemCampo } = linhaValida;
      expect(pedidoImportacaoSchema.safeParse(linhaSemCampo).success).toBe(false);
    }
  );

  it("rejeita clienteNome muito curto", () => {
    const resultado = pedidoImportacaoSchema.safeParse({ ...linhaValida, clienteNome: "A" });
    expect(resultado.success).toBe(false);
  });

  describe("quantidade", () => {
    it("ausente -> default 1", () => {
      const resultado = pedidoImportacaoSchema.safeParse(linhaValida);
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.quantidade).toBe(1);
    });

    it("não numérica -> default 1 (não rejeita a linha)", () => {
      const resultado = pedidoImportacaoSchema.safeParse({ ...linhaValida, quantidade: "abc" });
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.quantidade).toBe(1);
    });

    it("numérica válida -> arredonda pro inteiro mais próximo", () => {
      const resultado = pedidoImportacaoSchema.safeParse({ ...linhaValida, quantidade: "10,6" });
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.quantidade).toBe(11);
    });

    it("zero ou negativa -> default 1", () => {
      const resultado = pedidoImportacaoSchema.safeParse({ ...linhaValida, quantidade: "0" });
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.quantidade).toBe(1);
    });
  });

  describe("valorTotal", () => {
    it.each([
      ["1.234,56", 1234.56],
      ["R$ 99,90", 99.9],
    ])("'%s' -> %s (reusa parseNumeroBrasileiro)", (entrada, esperado) => {
      const resultado = pedidoImportacaoSchema.safeParse({ ...linhaValida, valorTotal: entrada });
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.valorTotal).toBe(esperado);
    });

    it("rejeita valor não numérico", () => {
      const resultado = pedidoImportacaoSchema.safeParse({ ...linhaValida, valorTotal: "abc" });
      expect(resultado.success).toBe(false);
    });

    it("rejeita valor zero ou negativo", () => {
      expect(pedidoImportacaoSchema.safeParse({ ...linhaValida, valorTotal: "0" }).success).toBe(false);
      expect(pedidoImportacaoSchema.safeParse({ ...linhaValida, valorTotal: "-10" }).success).toBe(false);
    });
  });

  describe("data", () => {
    it.each([
      ["15/03/2026", "2026-03-15"],
      ["15/03/26", "2026-03-15"],
      ["2026-03-15", "2026-03-15"],
    ])("'%s' -> %s (reusa parseDataBrasileira)", (entrada, esperadoIso) => {
      const resultado = pedidoImportacaoSchema.safeParse({ ...linhaValida, data: entrada });
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.data.toISOString().slice(0, 10)).toBe(esperadoIso);
    });

    it("rejeita data em formato não reconhecido", () => {
      const resultado = pedidoImportacaoSchema.safeParse({ ...linhaValida, data: "15 de março" });
      expect(resultado.success).toBe(false);
    });
  });

  it("campos opcionais (clienteDocumento/quantidade/vendedor/observacoes) ausentes não quebram a validação", () => {
    const resultado = pedidoImportacaoSchema.safeParse(linhaValida);
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.clienteDocumento).toBeUndefined();
      expect(resultado.data.vendedor).toBeUndefined();
      expect(resultado.data.observacoes).toBeUndefined();
    }
  });

  it("aceita todos os campos opcionais preenchidos", () => {
    const resultado = pedidoImportacaoSchema.safeParse({
      ...linhaValida,
      clienteDocumento: "123.456.789-00",
      quantidade: "500",
      vendedor: "Maria",
      observacoes: "Cliente pediu urgência",
    });
    expect(resultado.success).toBe(true);
  });
});
