"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { ehViolacaoDeUnicidade } from "@/lib/prisma-conflito";
import { ROTULOS_MOTIVO_PARADA } from "@/lib/parada-pedido-status";
import type { MotivoParada } from "@/generated/prisma/enums";

// Achado C2 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md, 2026-09-01) — mesma estrutura de
// entrega-actions.ts/terceirizacao-actions.ts: gate RBAC (PRODUCAO.podeEditar,
// mesmo módulo que controla o resto da fila de produção), isolamento de
// tenant via graficaId, auditoria em toda escrita. Diferente das duas
// features acima, ParadaPedido não tem uma FSM de transições — só um
// booleano "tem parada ativa agora?" (finalizadaEm null), então não existe
// um arquivo *-transicao.ts irmão aqui: a regra de negócio inteira (no
// máximo 1 ativa por pedido) cabe nestas duas actions.

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar a produção.";

const MOTIVOS_VALIDOS = new Set<MotivoParada>([
  "AGUARDANDO_MATERIAL",
  "AGUARDANDO_APROVACAO_CLIENTE",
  "AGUARDANDO_ARTE_CLIENTE",
  "MAQUINA_PARADA",
  "AGUARDANDO_TERCEIRO",
  "FALTA_OPERADOR",
  "OUTRO",
]);

export type IniciarParadaResult = { ok: boolean; mensagem: string };

// Abre uma ParadaPedido pra este pedido. apontamentoEtapaId é resolvido
// AQUI (não escolhido no formulário): é sempre o ApontamentoEtapa aberto
// (finalizadoEm null) do pedido no momento — a mesma etapa que
// fecharEAbrirApontamento (src/lib/apontamento-etapa.ts) mantém. null quando
// o pedido não tem nenhum apontamento aberto (pedido criado antes do achado
// B1/B2, sem backfill retroativo).
export async function iniciarParadaPedido(
  _estadoAnterior: IniciarParadaResult | null,
  formData: FormData
): Promise<IniciarParadaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const pedidoId = String(formData.get("pedidoId") ?? "");
  const motivoBruto = String(formData.get("motivo") ?? "");
  if (!MOTIVOS_VALIDOS.has(motivoBruto as MotivoParada)) {
    return { ok: false, mensagem: "Motivo inválido." };
  }
  const motivo = motivoBruto as MotivoParada;
  const motivoOutro = String(formData.get("motivoOutro") ?? "").trim().slice(0, 200) || null;
  if (motivo === "OUTRO" && !motivoOutro) {
    return { ok: false, mensagem: "Descreva o motivo quando escolher \"Outro\"." };
  }
  const solicitacaoCompraId = String(formData.get("solicitacaoCompraId") ?? "").trim() || null;
  const observacao = String(formData.get("observacao") ?? "").trim().slice(0, 2000) || null;

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    select: { id: true, status: true },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.status === "CANCELADO" || pedido.status === "ENTREGUE") {
    return { ok: false, mensagem: "Um pedido finalizado não pode ser marcado como parado." };
  }

  // Checagem otimista ANTES de criar — a garantia de verdade (contra corrida
  // real, ex: duas abas clicando quase juntas) é o índice único parcial da
  // migration (`paradas_pedido_pedido_ativa_key`, ver comentário no schema);
  // esta consulta só evita o round-trip de erro na maioria dos casos e dá
  // uma mensagem melhor que "erro de banco" quando não há corrida.
  const paradaAtiva = await prisma.paradaPedido.findFirst({
    where: { pedidoId, finalizadaEm: null },
    select: { id: true },
  });
  if (paradaAtiva) {
    return { ok: false, mensagem: "Este pedido já está marcado como parado. Finalize a parada atual antes de abrir outra." };
  }

  if (solicitacaoCompraId) {
    const compra = await prisma.solicitacaoCompra.findFirst({
      where: { id: solicitacaoCompraId, graficaId: usuario.graficaId },
      select: { id: true },
    });
    if (!compra) {
      return { ok: false, mensagem: "Solicitação de compra não encontrada." };
    }
  }

  // Etapa aberta ATUAL do pedido — mesmo critério de fecharEAbrirApontamento
  // (src/lib/apontamento-etapa.ts): "o apontamento com finalizadoEm null".
  const apontamentoAtivo = await prisma.apontamentoEtapa.findFirst({
    where: { pedidoId, finalizadoEm: null },
    select: { id: true },
  });

  let parada;
  try {
    parada = await prisma.paradaPedido.create({
      data: {
        graficaId: usuario.graficaId,
        pedidoId,
        apontamentoEtapaId: apontamentoAtivo?.id ?? null,
        motivo,
        motivoOutro,
        solicitacaoCompraId,
        observacao,
        criadoPorId: usuario.id,
      },
    });
  } catch (erro) {
    // Corrida real: outra requisição criou a parada ativa entre a checagem
    // otimista acima e este create — o índice único parcial barra no banco.
    if (ehViolacaoDeUnicidade(erro)) {
      return { ok: false, mensagem: "Este pedido já está marcado como parado. Finalize a parada atual antes de abrir outra." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "parada_pedido.iniciar",
    entidade: "ParadaPedido",
    entidadeId: parada.id,
    descricao: `Pedido ${pedidoId} marcado como parado (${ROTULOS_MOTIVO_PARADA[motivo]})`,
  });

  revalidatePath("/producao");
  return { ok: true, mensagem: "Parada registrada." };
}

export type FinalizarParadaResult = { ok: boolean; mensagem: string };

// Fecha a parada (finalizadaEm = now()). `observacao`, se enviada
// (mesmo critério "ausente = não mexer" do resto do projeto, ver
// campoOpcionalTexto em terceirizacao-actions.ts/entrega-actions.ts), é
// ANEXADA à observação já existente (não sobrescreve o motivo original
// registrado ao abrir) — a linha do tempo da parada fica legível como um
// pequeno log, não uma única string que alguém sobrescreve sem querer.
export async function finalizarParadaPedido(
  _estadoAnterior: FinalizarParadaResult | null,
  formData: FormData
): Promise<FinalizarParadaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const paradaId = String(formData.get("paradaId") ?? "");
  const observacaoResolucao = String(formData.get("observacao") ?? "").trim().slice(0, 2000) || null;

  const parada = await prisma.paradaPedido.findFirst({
    where: { id: paradaId, graficaId: usuario.graficaId },
  });
  if (!parada) {
    return { ok: false, mensagem: "Parada não encontrada." };
  }
  if (parada.finalizadaEm) {
    return { ok: false, mensagem: "Esta parada já foi finalizada." };
  }

  const observacaoFinal = observacaoResolucao
    ? [parada.observacao, `Resolução: ${observacaoResolucao}`].filter(Boolean).join("\n")
    : parada.observacao;

  // CAS (mesmo espírito de verificarEDispararAlertasAtraso): só finaliza se
  // AINDA estiver ativa no banco no instante do update — evita duas
  // requisições concorrentes (duplo clique) tentando finalizar a mesma
  // parada e uma delas gerando um registro de auditoria falso.
  const atualizacao = await prisma.paradaPedido.updateMany({
    where: { id: paradaId, finalizadaEm: null },
    data: { finalizadaEm: new Date(), observacao: observacaoFinal },
  });
  if (atualizacao.count === 0) {
    return { ok: false, mensagem: "Esta parada já foi finalizada." };
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "parada_pedido.finalizar",
    entidade: "ParadaPedido",
    entidadeId: parada.id,
    descricao: `Parada do pedido ${parada.pedidoId} finalizada (${ROTULOS_MOTIVO_PARADA[parada.motivo]})`,
  });

  revalidatePath("/producao");
  return { ok: true, mensagem: "Parada finalizada." };
}
