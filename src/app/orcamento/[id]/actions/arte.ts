"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import { put, del } from "@vercel/blob";
import { exigirTokenBlobPrivado } from "@/lib/blob-assinado";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { resolverLimiteDesconto, type AlcadaParaResolucao } from "@/lib/alcada-aprovacao";
import { calcularItemOrcamento, recalcularTotalOrcamento } from "@/lib/orcamento-precificacao";
import { analisarPreflight } from "@/lib/preflight";
import { resolverOrigemPublica } from "@/lib/url-publica";
import {
  validarArquivoArte,
  extensaoArte,
  assinaturaBateComTipo,
  BYTES_ASSINATURA,
} from "@/lib/upload-validacao";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_ORCAMENTO,
  type StatusOrcamento,
} from "@/lib/orcamento-status";
import {
  verificarProntidaoFiscal,
  prepararNotificacaoNotaFiscal,
  resolverDadosFiscais,
  resolverCfop,
  type DadosFiscaisResolvidos,
} from "@/lib/nota-fiscal";
import {
  emitirNfe,
  consultarNfe,
  ErroFocusNfe,
  type AmbienteFocusNfe,
  type RespostaFocusNfe,
  type ItemNfe,
} from "@/lib/focus-nfe";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateResponsavelNotaFiscal } from "@/lib/email/templates";
import { registrarAuditoria } from "@/lib/auditoria";
import { abrirApontamentoInicialSeNecessario } from "@/lib/apontamento-etapa";
import { formatoMoeda } from "@/lib/moeda";
import { dataInputParaUTC, dataHoraInputParaUTC, formatoInstanteReal } from "@/lib/data";
import {
  ETAPAS_ORCAMENTO,
  nomeCampoEtapaEm,
  nomeCampoEtapaResponsavel,
  type ChaveEtapaOrcamento,
} from "@/lib/orcamento-etapas";
import {
  validarContagemCor,
  normalizarRebobinamento,
  validarMaterialSubstratoOutro,
  validarCampoOutro,
} from "@/lib/orcamento-etiqueta";
import { parseJsonArray } from "@/lib/form-json";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { calcularValorBase, calcularComissao } from "@/lib/comissao";
import {
  removerArquivo,
  resolverContextoArmazenamento,
  reservarEspaco,
  confirmarArquivo,
  cancelarReserva,
} from "@/lib/billing/armazenamento";
import { calcularPrevisaoAprovacaoPedido, gravarPrevisaoAprovacaoPedido } from "@/lib/pedido-aprovacao";
import { criarCustoAutomaticoComissao } from "@/lib/custo-pedido";
import { gerarContasReceberDaAprovacao, gerarContasReceberDaEmissaoNota } from "@/lib/condicao-pagamento";
import { calcularExposicaoCreditoCliente } from "@/lib/exposicao-credito-cliente";
import { lancarConsumoCreditoCliente } from "@/lib/credito-cliente";
import { saldoContaReceber } from "@/lib/baixa-financeira";
import { registrarCandidatosGangRun } from "@/lib/gang-run-servico";
import { resolverOpcoesNaAprovacao, descartarOpcoesAlternativas } from "@/lib/orcamento-opcoes";
import { UNIDADES_DIMENSAO, converterParaCm } from "@/lib/unidade-dimensao";
import { paraDecimal, type Dec } from "@/lib/pricing/decimal";
import { aplicarPisoDoPedido } from "@/lib/pricing";
import { montarDadosItemParaRecalculo, calcularDescontoHerdado } from "@/lib/orcamento-duplicar";

export type EnviarArteOrcamentoResult = { ok: boolean; mensagem: string };

// Sobe a arte já na fase de orçamento, enquanto ainda é RASCUNHO — mesmo
// padrão de enviarArte (src/app/producao/actions.ts), mas mais simples:
// sem link/token de aprovação pública nem estado de "aguardando aprovação
// do cliente" (isso é exclusivo do fluxo de Pedido em produção; aqui é só
// pré-visualização pro cliente ver junto do orçamento, ver /o/[token]).
// access "public" pelo mesmo motivo de enviarArte: a arte é vista pelo
// cliente através do link com token de qualquer forma, sem segredo nenhum.
export async function enviarArteOrcamento(
  _estadoAnterior: EnviarArteOrcamentoResult | null,
  formData: FormData
): Promise<EnviarArteOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const orcamentoId = String(formData.get("orcamentoId"));
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) {
    return { ok: false, mensagem: "Selecione um arquivo." };
  }
  const validacao = validarArquivoArte(arquivo);
  if (!validacao.ok) {
    return { ok: false, mensagem: validacao.mensagem };
  }
  // Confere a assinatura real do arquivo, não só o Content-Type declarado
  // pelo cliente (forjável) — ver comentário em upload-validacao.ts.
  const cabecalho = new Uint8Array(await arquivo.slice(0, BYTES_ASSINATURA).arrayBuffer());
  if (!assinaturaBateComTipo(cabecalho, arquivo.type)) {
    return { ok: false, mensagem: "O conteúdo do arquivo não corresponde a um PDF, JPG ou PNG." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    // itens (largura/altura) só servem pro preflight abaixo.
    include: { itens: { select: { larguraCm: true, alturaCm: true } } },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  // Gate extra que enviarArte de Pedido não precisa ter: evita mexer num
  // arquivo que um Pedido já criado passou a referenciar (ver
  // atualizarStatusOrcamento/o/[token]/actions.ts, que copiam arteUrl pro
  // Pedido no momento da aprovação).
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível anexar arte enquanto o orçamento está em rascunho." };
  }

  // Reserva o espaço ANTES do put() — nunca depois, senão um upload rejeitado
  // por cota já teria custado o armazenamento (ver src/lib/billing/armazenamento.ts).
  const contextoArmazenamento = resolverContextoArmazenamento(usuario);
  const reserva = await reservarEspaco({
    graficaId: usuario.graficaId,
    tipo: "ARTE_ORCAMENTO",
    referenciaId: orcamentoId,
    bytes: arquivo.size,
    contexto: contextoArmazenamento,
  });
  if (!reserva.ok) {
    return { ok: false, mensagem: reserva.mensagem };
  }

  const extensao = extensaoArte(arquivo.type);
  let blob;
  try {
    blob = await put(`orcamentos-arte/${usuario.graficaId}/${orcamentoId}-${Date.now()}.${extensao}`, arquivo, {
      access: "public",
      addRandomSuffix: true,
      contentType: arquivo.type,
    });
  } catch (erro) {
    await cancelarReserva(reserva.arquivoId);
    // console.error sempre roda, mesmo sem SENTRY_DSN configurado (ver
    // src/lib/auditoria.ts) — mesmo cuidado de enviarArte (producao/actions.ts).
    console.error("[enviarArteOrcamento] falha ao subir arquivo no Vercel Blob", { graficaId: usuario.graficaId, orcamentoId }, erro);
    return {
      ok: false,
      mensagem: "Não foi possível enviar o arquivo agora. Tente de novo em instantes.",
    };
  }
  await confirmarArquivo(reserva.arquivoId, { url: blob.url, pathname: blob.pathname });

  // Preflight é melhor esforço (nunca lança, ver analisarPreflight) — mesmo
  // cuidado de enviarArte (producao/actions.ts): roda antes do update pra
  // gravar os achados no mesmo write que já grava arteUrl.
  const bufferArquivo = Buffer.from(await arquivo.arrayBuffer());
  const preflightAvisos = await analisarPreflight(
    bufferArquivo,
    arquivo.type,
    orcamento.itens.map((item) => ({
      larguraCm: item.larguraCm == null ? null : Number(item.larguraCm),
      alturaCm: item.alturaCm == null ? null : Number(item.alturaCm),
    }))
  );

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { arteUrl: blob.url, preflightAvisos },
  });

  // Apaga a arte anterior DEPOIS que a nova já está gravada no banco (melhor
  // esforço) — mesmo cuidado de enviarArte (producao/actions.ts): sem isso,
  // cada reenvio deixava o arquivo antigo no Blob pra sempre, público e sem
  // nenhuma referência no banco.
  if (orcamento.arteUrl) {
    await del(orcamento.arteUrl).catch(() => {});
  }

  revalidatePath(`/orcamento/${orcamentoId}`);

  return { ok: true, mensagem: "Arte enviada." };
}

// Única forma de liberar o espaço ocupado por uma arte de orçamento sem
// precisar substituí-la por outra — mesmos gates de enviarArteOrcamento.
export async function removerArteOrcamento(
  _estadoAnterior: EnviarArteOrcamentoResult | null,
  formData: FormData
): Promise<EnviarArteOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const orcamentoId = String(formData.get("orcamentoId"));
  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível anexar arte enquanto o orçamento está em rascunho." };
  }
  if (!orcamento.arteUrl) {
    return { ok: false, mensagem: "Este orçamento não tem arte enviada." };
  }

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { arteUrl: null, preflightAvisos: Prisma.JsonNull },
  });

  const arquivoRemovido = await removerArquivo({
    graficaId: usuario.graficaId,
    tipo: "ARTE_ORCAMENTO",
    referenciaId: orcamentoId,
  });
  if (arquivoRemovido) {
    await del(arquivoRemovido.url).catch(() => {});
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Arte removida." };
}
