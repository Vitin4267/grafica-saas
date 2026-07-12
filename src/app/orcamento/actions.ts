"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { calcularItemOrcamento } from "@/lib/orcamento-precificacao";
import { parseJsonArray } from "@/lib/form-json";
import { D } from "@/lib/pricing/decimal";
import { revalidatePath } from "next/cache";

// Item já digitado/computado no carrinho local (client) — o servidor NUNCA confia
// nos preços vindos daqui, só nos dados de entrada; recalcula tudo de novo com
// calcularItemOrcamento antes de gravar (ver criarOrcamento).
const itemEntradaSchema = z.object({
  itemGraficaId: z.string().min(1),
  quantidade: z.number().int().positive(),
  larguraCm: z.number().positive().nullable(),
  alturaCm: z.number().positive().nullable(),
  corFrente: z.number().int().nullable(),
  corVerso: z.number().int().nullable(),
  cores: z.string().max(60).nullable(),
  acabamento: z.string().max(200).nullable(),
});

export type PrecificarItemResult =
  | {
      ok: true;
      nome: string;
      categoria: string;
      precoUnitario: string;
      precoTotal: string;
      modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
    }
  | { ok: false; mensagem: string };

// Calcula o preço de UM item sem persistir nada — usado pelo carrinho da
// Calculadora de orçamento (e pelo "+ Adicionar item" na tela de detalhe) pra
// mostrar o preço real antes de o item entrar na lista. Itens M2/Offset só têm
// preço conhecido depois desse round-trip (o motor de precificação só roda no
// servidor); itens SIMPLES já têm prévia instantânea no cliente via calcularPreco,
// sem precisar chamar isto.
export async function precificarItem(input: {
  itemGraficaId: string;
  quantidade: number;
  larguraCm: number | null;
  alturaCm: number | null;
  corFrente: number | null;
  corVerso: number | null;
}): Promise<PrecificarItemResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  if (!input.itemGraficaId || !input.quantidade || input.quantidade <= 0) {
    return { ok: false, mensagem: "Escolha um produto e uma quantidade válida." };
  }

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: {
      id: input.itemGraficaId,
      graficaId: usuario.graficaId,
      ativo: true,
      precoVenda: { not: null },
    },
    include: { itemCatalogo: true },
  });
  if (!itemGrafica || !itemGrafica.precoVenda) {
    return { ok: false, mensagem: "Produto ou serviço não encontrado." };
  }

  const resultado = await calcularItemOrcamento(itemGrafica, usuario.graficaId, {
    quantidade: input.quantidade,
    larguraCm: input.larguraCm,
    alturaCm: input.alturaCm,
    corFrente: input.corFrente,
    corVerso: input.corVerso,
  });
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  return {
    ok: true,
    nome: itemGrafica.itemCatalogo.nome,
    categoria: itemGrafica.itemCatalogo.categoria,
    precoUnitario: resultado.precoUnitario,
    precoTotal: resultado.precoTotal,
    modeloCalculo: resultado.modeloCalculo,
  };
}

export type CriarOrcamentoResult = { ok: boolean; mensagem: string };

export async function criarOrcamento(
  _estadoAnterior: CriarOrcamentoResult | null,
  formData: FormData
): Promise<CriarOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra criar orçamentos." };
  }

  const clienteId = String(formData.get("clienteId"));
  const itensResult = parseJsonArray(formData.get("itensJson"), itemEntradaSchema);
  if (!itensResult.ok) {
    return { ok: false, mensagem: itensResult.mensagem };
  }
  if (itensResult.data.length === 0) {
    return { ok: false, mensagem: "Adicione pelo menos um item ao orçamento." };
  }

  // graficaId sempre vem da sessão autenticada, nunca do formulário: impede que
  // um tenant referencie cliente/item de outra gráfica.
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  // Soma em decimal.js (mesma instância configurada usada pelo motor de
  // precificação, src/lib/pricing/decimal.ts) — nunca em Number(), pra não
  // arriscar imprecisão de ponto flutuante binário numa soma de dinheiro.
  let total = new D(0);
  const itensParaCriar: {
    itemGraficaId: string;
    quantidade: number;
    larguraCm: number | null;
    alturaCm: number | null;
    cores: string | null;
    acabamento: string | null;
    precoUnitario: string;
    precoTotal: string;
    modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
    corFrente: number | null;
    corVerso: number | null;
    breakdown: Prisma.InputJsonValue | null;
  }[] = [];

  // Recalcula cada item no servidor — nunca confia no preço que veio do carrinho
  // do cliente (poderia ter sido adulterado no DOM/DevTools).
  for (const [indice, entrada] of itensResult.data.entries()) {
    const itemGrafica = await prisma.itemGrafica.findFirst({
      where: {
        id: entrada.itemGraficaId,
        graficaId: usuario.graficaId,
        ativo: true,
        precoVenda: { not: null },
      },
    });
    if (!itemGrafica || !itemGrafica.precoVenda) {
      return { ok: false, mensagem: `Item ${indice + 1}: produto ou serviço não encontrado.` };
    }

    const resultado = await calcularItemOrcamento(itemGrafica, usuario.graficaId, {
      quantidade: entrada.quantidade,
      larguraCm: entrada.larguraCm,
      alturaCm: entrada.alturaCm,
      corFrente: entrada.corFrente,
      corVerso: entrada.corVerso,
    });
    if (!resultado.ok) {
      return { ok: false, mensagem: `Item ${indice + 1}: ${resultado.mensagem}` };
    }

    total = total.plus(resultado.precoTotal);
    itensParaCriar.push({
      itemGraficaId: itemGrafica.id,
      quantidade: entrada.quantidade,
      larguraCm: entrada.larguraCm,
      alturaCm: entrada.alturaCm,
      cores: entrada.cores,
      acabamento: entrada.acabamento,
      precoUnitario: resultado.precoUnitario,
      precoTotal: resultado.precoTotal,
      modeloCalculo: resultado.modeloCalculo,
      corFrente: resultado.corFrente,
      corVerso: resultado.corVerso,
      breakdown: resultado.breakdown,
    });
  }

  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: usuario.graficaId,
      clienteId: cliente.id,
      usuarioId: usuario.id,
      total,
      itens: {
        create: itensParaCriar.map((item) => ({ ...item, breakdown: item.breakdown ?? undefined })),
      },
    },
  });

  revalidatePath("/orcamento");
  redirect(`/orcamento/${orcamento.id}`);
}
