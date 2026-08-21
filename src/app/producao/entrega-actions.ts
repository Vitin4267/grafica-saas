"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { ROTULOS_STATUS_ENTREGA, TRANSICOES_VALIDAS, type StatusEntrega } from "@/lib/entrega-status";
import { avancarStatusEntrega, type EntregaParaTransicao } from "./entrega-transicao";

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar a produção.";

export type CriarEntregaResult = { ok: boolean; mensagem: string };

// Cria a Entrega (1:1, sempre nasce em AGUARDANDO — ver default do schema)
// de um pedido que ainda não tem uma. Gate PRODUCAO (não um módulo novo, ver
// tarefa) — mesmo módulo que já controla o resto da fila em
// producao/page.tsx. motorista é opcional aqui: a gráfica pode só marcar
// "aguardando saída" e preencher quem vai levar depois, na hora de sair.
export async function criarEntrega(
  _estadoAnterior: CriarEntregaResult | null,
  formData: FormData
): Promise<CriarEntregaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const pedidoId = String(formData.get("pedidoId") ?? "");
  const motorista = String(formData.get("motorista") ?? "").trim().slice(0, 120) || null;

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    select: { id: true, status: true, entrega: { select: { id: true } } },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.status === "CANCELADO") {
    return { ok: false, mensagem: "Um pedido cancelado não pode ter entrega." };
  }
  if (pedido.entrega) {
    return { ok: false, mensagem: "Este pedido já tem uma entrega registrada." };
  }

  const entrega = await prisma.entrega.create({
    data: { graficaId: usuario.graficaId, pedidoId, motorista },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "entrega.criar",
    entidade: "Entrega",
    entidadeId: entrega.id,
    descricao: `Entrega criada para o pedido ${pedidoId}${motorista ? ` (motorista: ${motorista})` : ""}`,
  });

  revalidatePath("/producao");
  return { ok: true, mensagem: "Entrega criada." };
}

export type TransicaoEntregaResult = { ok: boolean; mensagem: string };

const STATUS_DESTINO_VALIDOS = new Set<StatusEntrega>(["AGUARDANDO", "EM_TRANSITO", "ENTREGUE", "PROBLEMA"]);

// Lê um campo opcional de transição da FormData: ausente = "não mexer nesse
// campo" (undefined), presente e vazio = "limpar" (null), presente com
// valor = o valor. Mesmo helper de campoOpcionalTransicao em
// src/app/compras/actions.ts.
function campoOpcionalTransicao(formData: FormData, nome: string): string | null | undefined {
  if (!formData.has(nome)) return undefined;
  const valor = String(formData.get(nome) ?? "").trim();
  return valor === "" ? null : valor;
}

// Avança (ou desvia pra PROBLEMA) uma Entrega — único ponto de entrada pra
// toda transição de status, reaproveitando avancarStatusEntrega
// (./entrega-transicao.ts) pro CAS. Mesmo formato de avancarSolicitacaoCompra
// (src/app/compras/actions.ts).
export async function avancarEntrega(
  _estadoAnterior: TransicaoEntregaResult | null,
  formData: FormData
): Promise<TransicaoEntregaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const entregaId = String(formData.get("entregaId") ?? "");
  const proximoStatusBruto = String(formData.get("proximoStatus") ?? "");
  if (!STATUS_DESTINO_VALIDOS.has(proximoStatusBruto as StatusEntrega)) {
    return { ok: false, mensagem: "Status de destino inválido." };
  }
  const proximoStatus = proximoStatusBruto as StatusEntrega;

  const entrega = await prisma.entrega.findFirst({
    where: { id: entregaId, graficaId: usuario.graficaId },
  });
  if (!entrega) {
    return { ok: false, mensagem: "Entrega não encontrada." };
  }
  if (!TRANSICOES_VALIDAS[entrega.status].includes(proximoStatus)) {
    return {
      ok: false,
      mensagem: `Não é possível mudar de "${ROTULOS_STATUS_ENTREGA[entrega.status]}" para "${ROTULOS_STATUS_ENTREGA[proximoStatus]}".`,
    };
  }

  const motoristaBruto = campoOpcionalTransicao(formData, "motorista");
  const observacoesBruto = campoOpcionalTransicao(formData, "observacoes");

  const entregaParaTransicao: EntregaParaTransicao = {
    id: entrega.id,
    graficaId: entrega.graficaId,
    status: entrega.status,
    motorista: entrega.motorista,
    dataSaida: entrega.dataSaida,
    dataEntrega: entrega.dataEntrega,
    observacoes: entrega.observacoes,
  };

  const resultado = await avancarStatusEntrega(entregaParaTransicao, proximoStatus, {
    motorista: motoristaBruto,
    observacoes: observacoesBruto,
  });

  if (resultado.ok) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: `entrega.status_${proximoStatus.toLowerCase()}`,
      entidade: "Entrega",
      entidadeId: entrega.id,
      descricao: `Entrega do pedido ${entrega.pedidoId} mudou de status`,
      valorAnterior: ROTULOS_STATUS_ENTREGA[resultado.statusAnterior],
      valorNovo: ROTULOS_STATUS_ENTREGA[resultado.proximoStatus],
    });
  }

  return resultado;
}
