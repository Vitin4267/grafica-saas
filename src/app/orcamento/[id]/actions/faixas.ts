"use server";

// Achado B5 da auditoria de abrangência (Parte 1) — CRUD da tabela de
// tiragens alternativas do MESMO item ("1.000/3.000/5.000 unidades"), ver
// comentário completo no model OrcamentoItemFaixaQuantidade (schema
// 09-orcamento.prisma) e em src/lib/orcamento-faixas-quantidade.ts. Feature
// PARALELA a opcoes.actions.ts (OrcamentoOpcao) — não reaproveita nem mexe
// naquele mecanismo.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { calcularItemOrcamento } from "@/lib/orcamento-precificacao";
import { MAX_FAIXAS_QUANTIDADE, montarDadosParaFaixa } from "@/lib/orcamento-faixas-quantidade";

export type AdicionarFaixaQuantidadeResult = { ok: boolean; mensagem: string };

// Adiciona UMA linha à tabela comparativa de tiragens de um item já
// existente — recalculada pelo mesmo motor de precificação
// (calcularItemOrcamento), só trocando `quantidade`. Nunca mexe em
// Orcamento.total nem em OrcamentoItem.precoTotal (a faixa é só uma
// COMPARAÇÃO exibida ao cliente, não um item de verdade do orçamento — ver
// LIMITAÇÃO CONHECIDA de promoção manual no comentário do model no schema).
export async function adicionarFaixaQuantidadeOrcamento(
  _estadoAnterior: AdicionarFaixaQuantidadeResult | null,
  formData: FormData
): Promise<AdicionarFaixaQuantidadeResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const orcamentoItemId = String(formData.get("orcamentoItemId") || "");
  const quantidade = Number(formData.get("quantidade"));
  if (!orcamentoItemId) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 1_000_000) {
    return { ok: false, mensagem: "Informe uma quantidade válida (até 1.000.000 unidades)." };
  }

  // opcaoId: null — mesma restrição de editarOrcamento/adicionarItemOrcamento
  // (src/app/orcamento/[id]/actions/itens.ts): uma opção alternativa (ver
  // OrcamentoOpcao) não tem edição incremental de item, então também não tem
  // tabela de faixas — a alternativa inteira é removida/recriada.
  const item = await prisma.orcamentoItem.findFirst({
    where: { id: orcamentoItemId, opcaoId: null, orcamento: { graficaId: usuario.graficaId } },
    include: {
      orcamento: { select: { id: true, status: true, cliente: { select: { margemPadraoOverride: true } } } },
      itemGrafica: true,
      acabamentos: { select: { itemGraficaId: true } },
      precificacaoEtiqueta: true,
      precificacaoDigital: true,
      precificacaoOffset: true,
      _count: { select: { faixasQuantidade: true } },
    },
  });
  if (!item) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  if (item.orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível adicionar faixas de quantidade a um orçamento em rascunho." };
  }
  if (item._count.faixasQuantidade >= MAX_FAIXAS_QUANTIDADE) {
    return {
      ok: false,
      mensagem: `Este item já tem o máximo de ${MAX_FAIXAS_QUANTIDADE} faixas de quantidade.`,
    };
  }

  const margemLucroOverride =
    item.orcamento.cliente.margemPadraoOverride !== null
      ? Number(item.orcamento.cliente.margemPadraoOverride)
      : null;

  const dados = montarDadosParaFaixa(item, quantidade, margemLucroOverride);
  const resultado = await calcularItemOrcamento(item.itemGrafica, usuario.graficaId, dados);
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  const quantidadeAtual = item._count.faixasQuantidade;
  await prisma.orcamentoItemFaixaQuantidade.create({
    data: {
      orcamentoItemId,
      quantidade,
      precoUnitario: resultado.precoUnitario,
      precoTotal: resultado.precoTotal,
      breakdown: resultado.breakdown ?? undefined,
      ordem: quantidadeAtual,
    },
  });

  revalidatePath(`/orcamento/${item.orcamento.id}`);

  return { ok: true, mensagem: "Faixa de quantidade adicionada." };
}

export type RemoverFaixaQuantidadeResult = { ok: boolean; mensagem: string };

export async function removerFaixaQuantidadeOrcamento(
  _estadoAnterior: RemoverFaixaQuantidadeResult | null,
  formData: FormData
): Promise<RemoverFaixaQuantidadeResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const faixaId = String(formData.get("faixaId") || "");
  if (!faixaId) {
    return { ok: false, mensagem: "Faixa não encontrada." };
  }

  const faixa = await prisma.orcamentoItemFaixaQuantidade.findFirst({
    where: { id: faixaId, orcamentoItem: { orcamento: { graficaId: usuario.graficaId } } },
    include: { orcamentoItem: { select: { orcamentoId: true, orcamento: { select: { status: true } } } } },
  });
  if (!faixa) {
    return { ok: false, mensagem: "Faixa não encontrada." };
  }
  if (faixa.orcamentoItem.orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível remover faixas de quantidade de um orçamento em rascunho." };
  }

  await prisma.orcamentoItemFaixaQuantidade.delete({ where: { id: faixaId } });

  revalidatePath(`/orcamento/${faixa.orcamentoItem.orcamentoId}`);

  return { ok: true, mensagem: "Faixa removida." };
}
