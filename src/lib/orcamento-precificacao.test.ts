import { describe, it, expect } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { calcularItemOrcamento } from "./orcamento-precificacao";

// Só cobre o modelo SIMPLES: é o único caminho que não toca o banco
// (M2/OFFSET chamam carregarContextoPrecificacao, que precisa de Prisma —
// fora do escopo de teste puro deste projeto). graficaId é um valor
// qualquer, nunca usado nesse caminho.
const ITEM_SIMPLES = {
  id: "item-1",
  modeloCalculo: "SIMPLES" as const,
  precoVenda: 10 as unknown as Prisma.Decimal,
};

describe("calcularItemOrcamento — modelo SIMPLES (achados da auditoria de 2026-07-23)", () => {
  it("aceita quantidade inteira positiva normal", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 3,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.precoTotal).toBe("30");
    }
  });

  it("rejeita quantidade fracionária (editarOrcamento/adicionarItemOrcamento liam isso sem zod)", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 2.5,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidade Infinity (Number('Infinity') ou Number('1e400') passavam pelo !quantidade || quantidade<=0 antigo)", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: Infinity,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidade zero", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 0,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidade negativa", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: -3,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidade NaN", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: NaN,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita altura infinita mesmo com largura válida", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: 10,
      alturaCm: Infinity,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita largura negativa", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: -10,
      alturaCm: 10,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  // Guardas do motor de clichê de etiqueta / faca / frete — mesmo raciocínio
  // das guardas de quantidade/largura acima: editarOrcamento/
  // adicionarItemOrcamento leem esses campos direto do FormData, sem zod.
  // ITEM_SIMPLES nem chega a tocar essas guardas (elas rodam antes do branch
  // SIMPLES/M2/OFFSET), então serve igual pros três casos abaixo.
  it("rejeita quantidadeCores fracionária", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: 1.5,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidadeCores menor que 1", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: 0,
      custoFaca: null,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita custoFaca negativo", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: -1,
      custoFrete: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita custoFrete negativo", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: -1,
    });
    expect(resultado.ok).toBe(false);
  });
});
