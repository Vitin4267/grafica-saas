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

const formaPagamentoSchema = z.enum([
  "DINHEIRO",
  "PIX",
  "CARTAO",
  "BOLETO",
  "TRANSFERENCIA",
  "OUTRO",
]);

export type RegistrarPagamentoResult = { ok: boolean; mensagem: string };

// Só permite registrar pagamento com o orçamento APROVADO — não faz sentido cobrar por
// algo que o cliente ainda não aceitou, e REJEITADO é estado terminal permanente
// (nunca é deletado, diferente de RASCUNHO). Sem bloqueio de valor: saldo devedor pode
// ficar negativo (cliente pagou a mais), é só informativo.
export async function registrarPagamento(
  _estadoAnterior: RegistrarPagamentoResult | null,
  formData: FormData
): Promise<RegistrarPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));
  const valor = Number(formData.get("valor"));
  const formaParsed = formaPagamentoSchema.safeParse(formData.get("forma"));
  const observacao = String(formData.get("observacao") || "").trim().slice(0, 500) || null;
  // Só guarda o detalhe quando a forma é OUTRO — nunca deixa texto órfão de
  // uma forma antiga sobrar se o usuário escolher outra forma (mesma
  // disciplina de src/app/financeiro/actions.ts pro formaPagamentoDetalhe
  // da Despesa).
  const formaDetalhe =
    formaParsed.success && formaParsed.data === "OUTRO"
      ? String(formData.get("formaDetalhe") || "").trim().slice(0, 160) || null
      : null;

  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, mensagem: "Informe um valor maior que zero." };
  }
  if (!formaParsed.success) {
    return { ok: false, mensagem: "Forma de pagamento inválida." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "APROVADO") {
    return {
      ok: false,
      mensagem: "Só é possível registrar pagamento em um orçamento aprovado.",
    };
  }

  // Reconciliação automática com Conta a Receber (2026-08-16, pedido do
  // usuário): se o valor bate EXATO com uma parcela PENDENTE deste mesmo
  // orçamento, marca ela como recebida também — sem isso, a fatura ficava
  // paga aqui mas pendente lá, mesmo o cliente tendo preenchido o próprio
  // campo de recebimento. Só reconcilia em match EXATO de valor TOTAL:
  // pagamento parcial ou com sobra não mexe em nada aqui (evita casar
  // errado — ver pendencias-negocio-pos-auditoria.md). Entre parcelas
  // pendentes do mesmo valor, pega a de vencimento mais próximo
  // (determinístico, não há como saber qual o cliente quis pagar). Tudo na
  // mesma transação, com compare-and-swap na ContaReceber (mesmo padrão de
  // registrarBaixaContaReceber em financeiro/contas-receber/actions.ts) — se
  // ela for marcada como recebida ou cancelada por outra requisição bem no
  // meio disso, não sobrescreve. ESTE BLOCO NÃO MUDOU desde 2026-08-16 —
  // preservado 100% (ver bloco de saldo remanescente logo abaixo, achado A8).
  const { pagamento, contaReceberVinculada } = await prisma.$transaction(async (tx) => {
    const pagamentoCriado = await tx.pagamento.create({
      data: { orcamentoId, valor, forma: formaParsed.data, formaDetalhe, observacao },
    });

    const candidata = await tx.contaReceber.findFirst({
      where: { orcamentoId, graficaId: usuario.graficaId, status: "PENDENTE", valor },
      orderBy: { vencimento: "asc" },
    });

    let vinculada: { id: string; descricao: string } | null = null;
    if (candidata) {
      const cas = await tx.contaReceber.updateMany({
        where: { id: candidata.id, status: "PENDENTE" },
        data: { status: "RECEBIDO", recebidoEm: new Date(), pagamentoId: pagamentoCriado.id },
      });
      if (cas.count > 0) {
        vinculada = { id: candidata.id, descricao: candidata.descricao };
      }
    }

    // Achado A8 da Parte 4 (2026-08-29): quando não há match de valor TOTAL
    // acima, tenta casar com o SALDO REMANESCENTE de uma conta já PARCIAL
    // (ex: parcela de R$5.000 com R$3.000 já baixados — um segundo
    // pagamento de R$2.000 fecha ela sozinho). Mesmo espírito determinístico
    // do bloco acima (vencimento mais próximo entre empates de saldo).
    // Deliberadamente NUNCA cria uma baixa PARCIAL nova por aqui — só fecha
    // uma conta cujo saldo já bate exato — porque decidir sozinho "esse
    // pagamento genérico do orçamento é parcial de QUAL conta" é a situação
    // ambígua que a proposta pede pra nunca resolver em silêncio; isso só
    // acontece com escolha explícita do usuário, em
    // registrarBaixaContaReceber (financeiro/contas-receber/actions.ts).
    if (!vinculada) {
      const parciais = await tx.contaReceber.findMany({
        where: { orcamentoId, graficaId: usuario.graficaId, status: "PARCIAL" },
        orderBy: { vencimento: "asc" },
      });
      for (const conta of parciais) {
        const saldo = await saldoContaReceber(tx, conta);
        if (!saldo.eq(valor)) continue;
        const cas = await tx.contaReceber.updateMany({
          where: { id: conta.id, status: "PARCIAL" },
          data: { status: "RECEBIDO", recebidoEm: new Date() },
        });
        if (cas.count > 0) {
          await tx.baixaContaReceber.create({
            data: { contaReceberId: conta.id, pagamentoId: pagamentoCriado.id, valor },
          });
          vinculada = { id: conta.id, descricao: conta.descricao };
        }
        break;
      }
    }

    return { pagamento: pagamentoCriado, contaReceberVinculada: vinculada };
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "pagamento.registrar",
    entidade: "Pagamento",
    entidadeId: pagamento.id,
    descricao: `Pagamento de ${formatoMoeda.format(valor)} (${formaParsed.data}) registrado no orçamento #${orcamentoId.slice(-6)}${
      contaReceberVinculada
        ? ` — conta a receber "${contaReceberVinculada.descricao}" marcada como recebida automaticamente`
        : ""
    }`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/meu-negocio");
  if (contaReceberVinculada) revalidatePath("/financeiro/contas-receber");

  return {
    ok: true,
    mensagem: contaReceberVinculada
      ? `Pagamento registrado com sucesso! A conta a receber "${contaReceberVinculada.descricao}" foi marcada como recebida automaticamente.`
      : "Pagamento registrado com sucesso!",
  };
}

export async function excluirPagamento(
  _estadoAnterior: RegistrarPagamentoResult | null,
  formData: FormData
): Promise<RegistrarPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const pagamentoId = String(formData.get("pagamentoId"));

  const pagamento = await prisma.pagamento.findFirst({
    where: { id: pagamentoId, orcamento: { graficaId: usuario.graficaId } },
  });
  if (!pagamento) {
    return { ok: false, mensagem: "Pagamento não encontrado." };
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "pagamento.excluir",
    entidade: "Pagamento",
    entidadeId: pagamento.id,
    descricao: `Pagamento de ${formatoMoeda.format(Number(pagamento.valor))} removido do orçamento #${pagamento.orcamentoId.slice(-6)}`,
  });

  await prisma.pagamento.delete({ where: { id: pagamento.id } });

  revalidatePath(`/orcamento/${pagamento.orcamentoId}`);
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: "Pagamento removido." };
}
