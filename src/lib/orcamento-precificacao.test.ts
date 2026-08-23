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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
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
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
    });
    expect(resultado.ok).toBe(false);
  });
});

// Guardas novas de DIGITAL/setup-por-peça (Feature A) — todas rodam ANTES do
// branch SIMPLES/carregarContextoPrecificacao, então não tocam o banco (mesma
// razão pela qual os testes de ITEM_SIMPLES acima também não tocam), apesar
// de referenciar itens que não existem de verdade — a guarda retorna antes de
// qualquer query.
const ITEM_DIGITAL = {
  id: "item-digital-1",
  modeloCalculo: "DIGITAL" as const,
  precoVenda: null as unknown as Prisma.Decimal | null,
};
const ITEM_SERIGRAFIA = {
  id: "item-serigrafia-1",
  modeloCalculo: "SERIGRAFIA" as const,
  precoVenda: null as unknown as Prisma.Decimal | null,
};
const ITEM_SUBLIMACAO = {
  id: "item-sublimacao-1",
  modeloCalculo: "SUBLIMACAO" as const,
  precoVenda: null as unknown as Prisma.Decimal | null,
};
const ITEM_ESTAMPAGEM = {
  id: "item-estampagem-1",
  modeloCalculo: "ESTAMPAGEM_QUENTE" as const,
  precoVenda: null as unknown as Prisma.Decimal | null,
};

function dadosBase(overrides: Partial<Parameters<typeof calcularItemOrcamento>[2]>) {
  return {
    quantidade: 10,
    larguraCm: null,
    alturaCm: null,
    corFrente: null,
    corVerso: null,
    acabamentoIds: [],
    papelId: null,
    quantidadeCores: null,
    custoFaca: null,
    custoFrete: null,
    numeroCoresFlexo: null,
    numeroCliques: null,
    numeroSetups: null,
    ...overrides,
  };
}

describe("calcularItemOrcamento — guardas novas (DIGITAL / setup-por-peça)", () => {
  it("DIGITAL: rejeita numeroCliques fracionário", async () => {
    const resultado = await calcularItemOrcamento(
      ITEM_DIGITAL,
      "grafica-1",
      dadosBase({ numeroCliques: 1.5 })
    );
    expect(resultado.ok).toBe(false);
  });

  it("DIGITAL: rejeita numeroCliques menor que 1", async () => {
    const resultado = await calcularItemOrcamento(
      ITEM_DIGITAL,
      "grafica-1",
      dadosBase({ numeroCliques: 0 })
    );
    expect(resultado.ok).toBe(false);
  });

  it("SERIGRAFIA: rejeita numeroSetups ausente (obrigatório, sem default)", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SERIGRAFIA, "grafica-1", dadosBase({}));
    expect(resultado.ok).toBe(false);
  });

  it("SERIGRAFIA: rejeita numeroSetups menor que 1", async () => {
    const resultado = await calcularItemOrcamento(
      ITEM_SERIGRAFIA,
      "grafica-1",
      dadosBase({ numeroSetups: 0 })
    );
    expect(resultado.ok).toBe(false);
  });

  it("SUBLIMACAO: rejeita numeroSetups ausente", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SUBLIMACAO, "grafica-1", dadosBase({}));
    expect(resultado.ok).toBe(false);
  });

  it("ESTAMPAGEM_QUENTE: rejeita numeroSetups ausente", async () => {
    const resultado = await calcularItemOrcamento(ITEM_ESTAMPAGEM, "grafica-1", dadosBase({}));
    expect(resultado.ok).toBe(false);
  });

  it("DIGITAL/setup-por-peça: quantidade/largura/altura continuam validadas mesmo sem exigir dimensão", async () => {
    // larguraCm negativo deve ser rejeitado mesmo pra um modelo cuja dimensão
    // é opcional — "opcional" não é "sem validação quando presente".
    const resultado = await calcularItemOrcamento(
      ITEM_DIGITAL,
      "grafica-1",
      dadosBase({ larguraCm: -10, alturaCm: 10 })
    );
    expect(resultado.ok).toBe(false);
  });
});
