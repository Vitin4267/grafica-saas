"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { dataInputParaUTC } from "@/lib/data";
import {
  ROTULOS_SITUACAO_TERCEIRIZACAO,
  TRANSICOES_VALIDAS,
  type SituacaoTerceirizacao,
} from "@/lib/terceirizacao-status";
import {
  avancarSituacaoTerceirizacao,
  type EtapaTerceirizadaParaTransicao,
} from "./terceirizacao-transicao";

// Achado E1 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md, 2026-09-01) — mesma estrutura de
// entrega-actions.ts: gate RBAC (PRODUCAO.podeEditar, mesmo módulo que
// controla o resto da fila de produção), isolamento de tenant via
// graficaId, e auditoria em toda escrita.

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar a produção.";

export type CriarTerceirizacaoResult = { ok: boolean; mensagem: string };

// Cria a EtapaTerceirizada a partir de um pedido em produção — escolher
// fornecedor cadastrado (Fornecedor, mesmo cadastro usado por
// SolicitacaoCompra) OU digitar um nome livre pra terceiro não cadastrado.
// status nasce como snapshot do StatusPedido ATUAL do pedido (congelado, não
// acompanha se o pedido avançar depois — ver comentário no schema).
export async function criarTerceirizacao(
  _estadoAnterior: CriarTerceirizacaoResult | null,
  formData: FormData
): Promise<CriarTerceirizacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const pedidoId = String(formData.get("pedidoId") ?? "");
  const fornecedorId = String(formData.get("fornecedorId") ?? "").trim() || null;
  const fornecedorNome = String(formData.get("fornecedorNome") ?? "").trim().slice(0, 160) || null;
  const previsaoRetornoBruto = formData.get("previsaoRetorno");
  const previsaoRetorno =
    typeof previsaoRetornoBruto === "string" && previsaoRetornoBruto
      ? dataInputParaUTC(previsaoRetornoBruto)
      : null;
  const valorAcordadoBruto = String(formData.get("valorAcordado") ?? "").trim();
  const valorAcordado = valorAcordadoBruto ? Number(valorAcordadoBruto) : null;
  const notaRemessa = String(formData.get("notaRemessa") ?? "").trim().slice(0, 60) || null;
  const observacao = String(formData.get("observacao") ?? "").trim().slice(0, 2000) || null;

  if (!fornecedorId && !fornecedorNome) {
    return { ok: false, mensagem: "Escolha um fornecedor cadastrado ou digite o nome do terceiro." };
  }
  if (valorAcordado !== null && (!Number.isFinite(valorAcordado) || valorAcordado < 0)) {
    return { ok: false, mensagem: "Valor acordado inválido." };
  }

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    select: { id: true, status: true },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.status === "CANCELADO") {
    return { ok: false, mensagem: "Um pedido cancelado não pode ter terceirização." };
  }

  // Fornecedor formal precisa pertencer a esta gráfica — mesma checagem de
  // tenant de qualquer FK opcional escolhida em formulário (ver
  // avancarStatusCompra/AcoesSolicitacaoForm.tsx).
  if (fornecedorId) {
    const fornecedor = await prisma.fornecedor.findFirst({
      where: { id: fornecedorId, graficaId: usuario.graficaId },
      select: { id: true },
    });
    if (!fornecedor) {
      return { ok: false, mensagem: "Fornecedor não encontrado." };
    }
  }

  const etapa = await prisma.etapaTerceirizada.create({
    data: {
      graficaId: usuario.graficaId,
      pedidoId,
      status: pedido.status,
      fornecedorId,
      fornecedorNome,
      previsaoRetorno,
      valorAcordado,
      notaRemessa,
      observacao,
      criadoPorId: usuario.id,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "etapa_terceirizada.criar",
    entidade: "EtapaTerceirizada",
    entidadeId: etapa.id,
    descricao: `Terceirização registrada pro pedido ${pedidoId} (${fornecedorNome ?? "fornecedor cadastrado"})`,
  });

  revalidatePath("/producao");
  return { ok: true, mensagem: "Terceirização registrada." };
}

export type TransicaoTerceirizacaoResult = { ok: boolean; mensagem: string };

const SITUACOES_DESTINO_VALIDAS = new Set<SituacaoTerceirizacao>([
  "AGUARDANDO_ENVIO",
  "ENVIADO",
  "RETORNADO",
  "PROBLEMA",
]);

// Lê um campo opcional de transição da FormData: ausente = "não mexer nesse
// campo" (undefined), presente e vazio = "limpar" (null), presente com valor
// = o valor. Mesmo helper de campoOpcionalTransicao em
// src/app/producao/entrega-actions.ts e src/app/compras/actions.ts.
function campoOpcionalTexto(formData: FormData, nome: string): string | null | undefined {
  if (!formData.has(nome)) return undefined;
  const valor = String(formData.get(nome) ?? "").trim();
  return valor === "" ? null : valor;
}

function campoOpcionalData(formData: FormData, nome: string): Date | null | undefined {
  if (!formData.has(nome)) return undefined;
  const valor = String(formData.get(nome) ?? "").trim();
  return valor === "" ? null : dataInputParaUTC(valor);
}

function campoOpcionalValor(formData: FormData, nome: string): number | null | undefined {
  if (!formData.has(nome)) return undefined;
  const valor = String(formData.get(nome) ?? "").trim();
  if (valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : undefined;
}

// Avança (ou desvia pra PROBLEMA) uma EtapaTerceirizada — único ponto de
// entrada pra toda transição de situação, reaproveitando
// avancarSituacaoTerceirizacao (./terceirizacao-transicao.ts) pro CAS. Mesmo
// formato de avancarEntrega (src/app/producao/entrega-actions.ts).
export async function avancarTerceirizacao(
  _estadoAnterior: TransicaoTerceirizacaoResult | null,
  formData: FormData
): Promise<TransicaoTerceirizacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const etapaId = String(formData.get("etapaId") ?? "");
  const proximaSituacaoBruta = String(formData.get("proximaSituacao") ?? "");
  if (!SITUACOES_DESTINO_VALIDAS.has(proximaSituacaoBruta as SituacaoTerceirizacao)) {
    return { ok: false, mensagem: "Situação de destino inválida." };
  }
  const proximaSituacao = proximaSituacaoBruta as SituacaoTerceirizacao;

  const etapa = await prisma.etapaTerceirizada.findFirst({
    where: { id: etapaId, graficaId: usuario.graficaId },
  });
  if (!etapa) {
    return { ok: false, mensagem: "Terceirização não encontrada." };
  }
  if (!TRANSICOES_VALIDAS[etapa.situacao].includes(proximaSituacao)) {
    return {
      ok: false,
      mensagem: `Não é possível mudar de "${ROTULOS_SITUACAO_TERCEIRIZACAO[etapa.situacao]}" para "${ROTULOS_SITUACAO_TERCEIRIZACAO[proximaSituacao]}".`,
    };
  }

  const fornecedorIdBruto = campoOpcionalTexto(formData, "fornecedorId");
  if (fornecedorIdBruto) {
    const fornecedor = await prisma.fornecedor.findFirst({
      where: { id: fornecedorIdBruto, graficaId: usuario.graficaId },
      select: { id: true },
    });
    if (!fornecedor) {
      return { ok: false, mensagem: "Fornecedor não encontrado." };
    }
  }

  const etapaParaTransicao: EtapaTerceirizadaParaTransicao = {
    id: etapa.id,
    graficaId: etapa.graficaId,
    pedidoId: etapa.pedidoId,
    situacao: etapa.situacao,
    fornecedorId: etapa.fornecedorId,
    fornecedorNome: etapa.fornecedorNome,
    enviadoEm: etapa.enviadoEm,
    previsaoRetorno: etapa.previsaoRetorno,
    retornadoEm: etapa.retornadoEm,
    valorAcordado: etapa.valorAcordado,
    valorFinal: etapa.valorFinal,
    notaRemessa: etapa.notaRemessa,
    notaRetorno: etapa.notaRetorno,
    observacao: etapa.observacao,
  };

  const resultado = await avancarSituacaoTerceirizacao(etapaParaTransicao, proximaSituacao, {
    fornecedorId: fornecedorIdBruto,
    fornecedorNome: campoOpcionalTexto(formData, "fornecedorNome"),
    previsaoRetorno: campoOpcionalData(formData, "previsaoRetorno"),
    valorAcordado: campoOpcionalValor(formData, "valorAcordado"),
    valorFinal: campoOpcionalValor(formData, "valorFinal"),
    notaRemessa: campoOpcionalTexto(formData, "notaRemessa"),
    notaRetorno: campoOpcionalTexto(formData, "notaRetorno"),
    observacao: campoOpcionalTexto(formData, "observacao"),
  });

  if (resultado.ok) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: `etapa_terceirizada.situacao_${proximaSituacao.toLowerCase()}`,
      entidade: "EtapaTerceirizada",
      entidadeId: etapa.id,
      descricao: `Terceirização do pedido ${etapa.pedidoId} mudou de situação`,
      valorAnterior: ROTULOS_SITUACAO_TERCEIRIZACAO[resultado.situacaoAnterior],
      valorNovo: ROTULOS_SITUACAO_TERCEIRIZACAO[resultado.proximaSituacao],
    });
  }

  return resultado;
}
