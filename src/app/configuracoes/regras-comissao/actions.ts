"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { BaseComissao } from "@/generated/prisma/enums";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";

export type SalvarRegraComissaoResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";

// Achado A12 da Parte 4 da auditoria de abrangência (2026-09-09) — CRUD de
// RegraComissao (ver resolverRegraComissao em src/lib/comissao.ts e o model
// no schema, 11-financeiro.prisma). Mesmo padrão de
// src/app/configuracoes/alcadas/actions.ts: valida, confere tenant, grava,
// audita.
function validarPercentualFracao(valor: unknown, rotulo: string): number | { erro: string } {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0 || numero > 1) {
    return { erro: `${rotulo} deve ser uma fração entre 0 e 1 (ex: 0.05 = 5%).` };
  }
  return numero;
}

async function validarDadosRegra(
  formData: FormData,
  graficaId: string
): Promise<
  | {
      ok: true;
      prioridade: number;
      usuarioId: string | null;
      itemCatalogoId: string | null;
      tipoItem: string | null;
      margemMinPercent: number | null;
      margemMaxPercent: number | null;
      percentual: number;
      baseCalculo: BaseComissao | null;
    }
  | { ok: false; mensagem: string }
> {
  const usuarioIdBruto = String(formData.get("usuarioId") ?? "").trim();
  let usuarioId: string | null = null;
  if (usuarioIdBruto) {
    const usuarioAlvo = await prisma.usuario.findFirst({
      where: { id: usuarioIdBruto, graficaId },
      select: { id: true },
    });
    if (!usuarioAlvo) return { ok: false, mensagem: "Usuário não encontrado." };
    usuarioId = usuarioAlvo.id;
  }

  const itemCatalogoIdBruto = String(formData.get("itemCatalogoId") ?? "").trim();
  let itemCatalogoId: string | null = null;
  if (itemCatalogoIdBruto) {
    // Item pode ser do catálogo mestre (graficaId null) OU privado desta
    // gráfica — nunca de OUTRA gráfica (mesmo cuidado de tenant isolation
    // de qualquer FK vinda de formulário).
    const itemAlvo = await prisma.itemCatalogo.findFirst({
      where: { id: itemCatalogoIdBruto, OR: [{ graficaId }, { graficaId: null }] },
      select: { id: true },
    });
    if (!itemAlvo) return { ok: false, mensagem: "Produto/matéria-prima não encontrado." };
    itemCatalogoId = itemAlvo.id;
  }

  const tipoItemBruto = String(formData.get("tipoItem") ?? "").trim();
  const tipoItem = tipoItemBruto || null;

  const margemMinBruto = String(formData.get("margemMinPercent") ?? "").trim();
  let margemMinPercent: number | null = null;
  if (margemMinBruto) {
    const validado = validarPercentualFracao(margemMinBruto, "Margem mínima");
    if (typeof validado !== "number") return { ok: false, mensagem: validado.erro };
    margemMinPercent = validado;
  }

  const margemMaxBruto = String(formData.get("margemMaxPercent") ?? "").trim();
  let margemMaxPercent: number | null = null;
  if (margemMaxBruto) {
    const validado = validarPercentualFracao(margemMaxBruto, "Margem máxima");
    if (typeof validado !== "number") return { ok: false, mensagem: validado.erro };
    margemMaxPercent = validado;
  }
  if (margemMinPercent !== null && margemMaxPercent !== null && margemMinPercent > margemMaxPercent) {
    return { ok: false, mensagem: "A margem mínima não pode ser maior que a margem máxima." };
  }

  const percentualValidado = validarPercentualFracao(formData.get("percentual"), "Percentual de comissão");
  if (typeof percentualValidado !== "number") return { ok: false, mensagem: percentualValidado.erro };
  if (percentualValidado <= 0) {
    return { ok: false, mensagem: "Percentual de comissão deve ser maior que zero." };
  }

  const baseCalculoBruto = String(formData.get("baseCalculo") ?? "");
  let baseCalculo: BaseComissao | null = null;
  if (baseCalculoBruto === "VALOR" || baseCalculoBruto === "LUCRO") {
    baseCalculo = baseCalculoBruto;
  } else if (baseCalculoBruto !== "") {
    return { ok: false, mensagem: "Base de cálculo inválida." };
  }

  const prioridadeBruto = formData.get("prioridade");
  const prioridade = prioridadeBruto ? Number(prioridadeBruto) : 0;
  if (!Number.isInteger(prioridade)) {
    return { ok: false, mensagem: "Prioridade deve ser um número inteiro." };
  }

  return {
    ok: true,
    prioridade,
    usuarioId,
    itemCatalogoId,
    tipoItem,
    margemMinPercent,
    margemMaxPercent,
    percentual: percentualValidado,
    baseCalculo,
  };
}

export async function criarRegraComissao(
  _estadoAnterior: SalvarRegraComissaoResult | null,
  formData: FormData
): Promise<SalvarRegraComissaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const validado = await validarDadosRegra(formData, usuario.graficaId);
  if (!validado.ok) return validado;

  const novaRegra = await prisma.regraComissao.create({
    data: {
      graficaId: usuario.graficaId,
      prioridade: validado.prioridade,
      usuarioId: validado.usuarioId,
      itemCatalogoId: validado.itemCatalogoId,
      tipoItem: validado.tipoItem,
      margemMinPercent: validado.margemMinPercent,
      margemMaxPercent: validado.margemMaxPercent,
      percentual: validado.percentual,
      baseCalculo: validado.baseCalculo,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_regra_comissao",
    entidade: "RegraComissao",
    entidadeId: novaRegra.id,
    descricao: `Regra de comissão criada — ${(validado.percentual * 100).toFixed(2)}%`,
  });

  revalidatePath("/configuracoes/regras-comissao");
  return { ok: true, mensagem: "Regra de comissão cadastrada." };
}

export async function editarRegraComissao(
  _estadoAnterior: SalvarRegraComissaoResult | null,
  formData: FormData
): Promise<SalvarRegraComissaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const regraId = String(formData.get("regraId") ?? "");
  const regra = await prisma.regraComissao.findFirst({
    where: { id: regraId, graficaId: usuario.graficaId },
  });
  if (!regra) {
    return { ok: false, mensagem: "Regra de comissão não encontrada." };
  }

  const validado = await validarDadosRegra(formData, usuario.graficaId);
  if (!validado.ok) return validado;

  await prisma.regraComissao.update({
    where: { id: regraId },
    data: {
      prioridade: validado.prioridade,
      usuarioId: validado.usuarioId,
      itemCatalogoId: validado.itemCatalogoId,
      tipoItem: validado.tipoItem,
      margemMinPercent: validado.margemMinPercent,
      margemMaxPercent: validado.margemMaxPercent,
      percentual: validado.percentual,
      baseCalculo: validado.baseCalculo,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.editar_regra_comissao",
    entidade: "RegraComissao",
    entidadeId: regraId,
    descricao: `Regra de comissão atualizada — ${(validado.percentual * 100).toFixed(2)}%`,
  });

  revalidatePath("/configuracoes/regras-comissao");
  return { ok: true, mensagem: "Regra de comissão atualizada." };
}

// Liga/desliga sem apagar — mesmo padrão de soft-delete do resto do repo
// (CategoriaCusto.ativa, CondicaoPagamento.ativa).
export async function alternarAtivaRegraComissao(
  _estadoAnterior: SalvarRegraComissaoResult | null,
  formData: FormData
): Promise<SalvarRegraComissaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const regraId = String(formData.get("regraId") ?? "");
  const regra = await prisma.regraComissao.findFirst({
    where: { id: regraId, graficaId: usuario.graficaId },
  });
  if (!regra) {
    return { ok: false, mensagem: "Regra de comissão não encontrada." };
  }

  await prisma.regraComissao.update({
    where: { id: regraId },
    data: { ativa: !regra.ativa },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: regra.ativa ? "configuracoes.desativar_regra_comissao" : "configuracoes.ativar_regra_comissao",
    entidade: "RegraComissao",
    entidadeId: regraId,
    descricao: `Regra de comissão ${regra.ativa ? "desativada" : "ativada"}`,
  });

  revalidatePath("/configuracoes/regras-comissao");
  return { ok: true, mensagem: regra.ativa ? "Regra desativada." : "Regra ativada." };
}

export async function excluirRegraComissao(
  _estadoAnterior: SalvarRegraComissaoResult | null,
  formData: FormData
): Promise<SalvarRegraComissaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const regraId = String(formData.get("regraId") ?? "");
  const regra = await prisma.regraComissao.findFirst({
    where: { id: regraId, graficaId: usuario.graficaId },
  });
  if (!regra) {
    return { ok: false, mensagem: "Regra de comissão não encontrada." };
  }

  // Sem soft-delete de propósito: RegraComissao nunca é referenciada por
  // histórico (Comissao é SNAPSHOT, não FK pra cá) — mesmo raciocínio de
  // AlcadaAprovacao. Excluir só faz a venda voltar a resolver pela próxima
  // regra mais específica (ou pro fallback de sempre).
  await prisma.regraComissao.delete({ where: { id: regraId } });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.excluir_regra_comissao",
    entidade: "RegraComissao",
    entidadeId: regraId,
    descricao: `Regra de comissão excluída — ${(Number(regra.percentual) * 100).toFixed(2)}%`,
  });

  revalidatePath("/configuracoes/regras-comissao");
  return { ok: true, mensagem: "Regra de comissão excluída." };
}
