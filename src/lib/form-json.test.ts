import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseJsonArray } from "./form-json";

const itemSchema = z.object({
  nome: z.string().min(1, "Nome obrigatório"),
  quantidade: z.number().positive(),
});

describe("parseJsonArray", () => {
  it("entrada null/vazia retorna array vazio (não é erro)", () => {
    expect(parseJsonArray(null, itemSchema)).toEqual({ ok: true, data: [] });
    expect(parseJsonArray("", itemSchema)).toEqual({ ok: true, data: [] });
  });

  it("JSON malformado retorna erro amigável", () => {
    const resultado = parseJsonArray("{não é json válido", itemSchema);
    expect(resultado.ok).toBe(false);
  });

  it("JSON válido mas que não é array retorna erro", () => {
    const resultado = parseJsonArray(JSON.stringify({ nome: "x", quantidade: 1 }), itemSchema);
    expect(resultado.ok).toBe(false);
  });

  it("array com item que falha a validação do schema retorna erro com a mensagem do zod", () => {
    const resultado = parseJsonArray(
      JSON.stringify([{ nome: "", quantidade: 1 }]),
      itemSchema
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensagem).toBe("Nome obrigatório");
    }
  });

  it("array válido é parseado e validado item a item", () => {
    const resultado = parseJsonArray(
      JSON.stringify([
        { nome: "Item 1", quantidade: 2 },
        { nome: "Item 2", quantidade: 5 },
      ]),
      itemSchema
    );
    expect(resultado).toEqual({
      ok: true,
      data: [
        { nome: "Item 1", quantidade: 2 },
        { nome: "Item 2", quantidade: 5 },
      ],
    });
  });

  it("um item inválido no meio da lista invalida a lista inteira (não filtra silenciosamente)", () => {
    const resultado = parseJsonArray(
      JSON.stringify([
        { nome: "Válido", quantidade: 1 },
        { nome: "Inválido", quantidade: -5 },
      ]),
      itemSchema
    );
    expect(resultado.ok).toBe(false);
  });

  it("respeita o limite opcional de tamanho, sem nem chegar a validar os itens", () => {
    const resultado = parseJsonArray(
      JSON.stringify([
        { nome: "1", quantidade: 1 },
        { nome: "2", quantidade: 1 },
        { nome: "3", quantidade: 1 },
      ]),
      itemSchema,
      { max: 2 }
    );
    expect(resultado.ok).toBe(false);
  });

  it("array dentro do limite passa normalmente", () => {
    const resultado = parseJsonArray(JSON.stringify([{ nome: "1", quantidade: 1 }]), itemSchema, {
      max: 2,
    });
    expect(resultado.ok).toBe(true);
  });
});
