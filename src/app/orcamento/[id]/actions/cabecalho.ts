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

export type AlterarClienteResult = { ok: boolean; mensagem: string };

export async function alterarClienteOrcamento(
  _estadoAnterior: AlterarClienteResult | null,
  formData: FormData
): Promise<AlterarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));
  const clienteId = String(formData.get("clienteId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível trocar o cliente de um orçamento em rascunho." };
  }

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { clienteId: cliente.id },
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Cliente atualizado." };
}

const tipoPedidoSchema = z.enum([
  "MODELO_NOVO",
  "REPETICAO_SEM_ALTERACAO",
  "REPETICAO_COM_ALTERACAO",
]);
const freteSchema = z.enum([
  "CIF_REMETENTE",
  "FOB_DESTINATARIO",
  "TERCEIROS",
  "PROPRIO_REMETENTE",
  "PROPRIO_DESTINATARIO",
  "SEM_FRETE",
]);

export type EditarDadosGeraisResult = { ok: boolean; mensagem: string };

// Campos gerais do pedido (vendedor, tipo de pedido, contato específico
// deste orçamento, condições de pagamento, frete, transportadora, local de
// entrega, observações internas) — editáveis a QUALQUER status, diferente do
// resto do orçamento (que trava em RASCUNHO): nenhum desses campos mexe no
// total nem no preço que o cliente já viu, e frete/transportadora
// normalmente só são definidos depois que o cliente aprova.
export async function editarDadosGeraisOrcamento(
  _estadoAnterior: EditarDadosGeraisResult | null,
  formData: FormData
): Promise<EditarDadosGeraisResult> {
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

  const tipoPedidoBruto = formData.get("tipoPedido");
  const tipoPedidoParsed = tipoPedidoBruto ? tipoPedidoSchema.safeParse(tipoPedidoBruto) : null;
  if (tipoPedidoParsed && !tipoPedidoParsed.success) {
    return { ok: false, mensagem: "Tipo de pedido inválido." };
  }

  const freteBruto = formData.get("frete");
  const freteParsed = freteBruto ? freteSchema.safeParse(freteBruto) : null;
  if (freteParsed && !freteParsed.success) {
    return { ok: false, mensagem: "Tipo de frete inválido." };
  }

  // Achado A4 da Parte 5 — contatoClienteId nunca é lido do form sem
  // verificar que o contato pertence ao MESMO cliente deste orçamento (nunca
  // confia no id cru vindo do <select>, mesmo princípio de validarVendedorId
  // em clientes/actions.ts). "" = digitação manual, sem contato escolhido.
  const contatoClienteIdBruto = String(formData.get("contatoClienteId") ?? "").trim();
  let contatoClienteId: string | null = null;
  if (contatoClienteIdBruto) {
    const contatoCliente = await prisma.contatoCliente.findFirst({
      where: { id: contatoClienteIdBruto, clienteId: orcamento.clienteId },
      select: { id: true },
    });
    if (!contatoCliente) {
      return { ok: false, mensagem: "Contato selecionado inválido." };
    }
    contatoClienteId = contatoCliente.id;
  }

  // Achado A5 da Parte 5 — mesmo princípio de contatoClienteId acima:
  // enderecoEntregaId nunca é lido do form sem verificar que o endereço
  // pertence ao MESMO cliente deste orçamento. "" = digitação manual, sem
  // endereço escolhido (localEntrega continua funcionando exatamente como
  // hoje pra quem não usa EnderecoCliente).
  const enderecoEntregaIdBruto = String(formData.get("enderecoEntregaId") ?? "").trim();
  let enderecoEntregaId: string | null = null;
  if (enderecoEntregaIdBruto) {
    const enderecoCliente = await prisma.enderecoCliente.findFirst({
      where: { id: enderecoEntregaIdBruto, clienteId: orcamento.clienteId },
      select: { id: true },
    });
    if (!enderecoCliente) {
      return { ok: false, mensagem: "Endereço de entrega selecionado inválido." };
    }
    enderecoEntregaId = enderecoCliente.id;
  }

  // Achado F3 da auditoria de abrangência — mesmo princípio de
  // contatoClienteId/enderecoEntregaId acima: transportadoraId nunca é lido
  // do form sem verificar que a transportadora pertence à MESMA gráfica
  // (nunca confia no id cru vindo do <select>). "" = digitação manual, sem
  // transportadora escolhida (`transportadora` texto livre continua
  // funcionando exatamente como hoje).
  const transportadoraIdBruto = String(formData.get("transportadoraId") ?? "").trim();
  let transportadoraId: string | null = null;
  if (transportadoraIdBruto) {
    const transportadora = await prisma.transportadora.findFirst({
      where: { id: transportadoraIdBruto, graficaId: usuario.graficaId },
      select: { id: true },
    });
    if (!transportadora) {
      return { ok: false, mensagem: "Transportadora selecionada inválida." };
    }
    transportadoraId = transportadora.id;
  }

  // Achado F3 da auditoria de abrangência — valor do frete em R$, opcional.
  // "" = sem valor informado (null, mesmo comportamento de hoje: a NF-e
  // manda valor_frete "0" fixo). Formato inválido é ignorado silenciosamente
  // (cai em null) em vez de bloquear o resto do formulário — mesmo espírito
  // permissivo do resto desta action (campos gerais, nunca trava o salvar).
  const valorFreteBruto = String(formData.get("valorFrete") ?? "").trim();
  let valorFrete: number | null = null;
  if (valorFreteBruto) {
    const parsed = Number(valorFreteBruto);
    if (Number.isFinite(parsed) && parsed >= 0) {
      valorFrete = parsed;
    }
  }

  const campoTexto = (nome: string, max: number) =>
    String(formData.get(nome) || "").trim().slice(0, max) || null;

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: {
      vendedor: campoTexto("vendedor", 120),
      tipoPedido: tipoPedidoParsed?.success ? tipoPedidoParsed.data : null,
      contatoNome: campoTexto("contatoNome", 120),
      contatoEmail: campoTexto("contatoEmail", 200),
      contatoClienteId,
      condicoesPagamento: campoTexto("condicoesPagamento", 200),
      frete: freteParsed?.success ? freteParsed.data : null,
      transportadora: campoTexto("transportadora", 120),
      transportadoraId,
      valorFrete,
      localEntrega: campoTexto("localEntrega", 500),
      enderecoEntregaId,
      notaEmpenho: campoTexto("notaEmpenho", 100),
      processoLicitatorio: campoTexto("processoLicitatorio", 100),
      observacoes: campoTexto("observacoes", 2000),
    },
  });

  // Sem gate de status, esses campos podem ser reescritos a qualquer momento
  // por qualquer pessoa com acesso — o log é o único jeito de saber depois
  // quem mudou o quê (ver comentário de editarEtapasOrcamento, mesma lógica).
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "orcamento.editar_dados_gerais",
    entidade: "Orcamento",
    entidadeId: orcamentoId,
    descricao: `Dados gerais atualizados no orçamento #${orcamentoId.slice(-6)}`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Dados do pedido atualizados." };
}

export type EditarEtapasResult = { ok: boolean; mensagem: string };

// As 5 etapas de produção (data/hora + responsável cada, ver
// src/lib/orcamento-etapas.ts) — editável a qualquer status (a maioria só
// faz sentido depois de RASCUNHO mesmo: Aprovação/Pedido/Entrega acontecem
// depois que o orçamento já avançou). Responsável é texto livre porque pode
// ser uma pessoa diferente de quem está logado (alguém registrando o
// trabalho de outra pessoa) — não é um log de eventos, é editável direto.
export async function editarEtapasOrcamento(
  _estadoAnterior: EditarEtapasResult | null,
  formData: FormData
): Promise<EditarEtapasResult> {
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

  const valoresPorChave = Object.fromEntries(
    ETAPAS_ORCAMENTO.map(({ chave }) => {
      const emBruto = formData.get(nomeCampoEtapaEm(chave));
      const em = typeof emBruto === "string" && emBruto ? dataHoraInputParaUTC(emBruto) : null;
      const responsavel =
        String(formData.get(nomeCampoEtapaResponsavel(chave)) || "").trim().slice(0, 120) || null;
      return [chave, { em, responsavel }];
    })
  ) as Record<ChaveEtapaOrcamento, { em: Date | null; responsavel: string | null }>;

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: {
      etapaOrcamentoDesenvolvimentoEm: valoresPorChave.orcamentoDesenvolvimento.em,
      etapaOrcamentoDesenvolvimentoResponsavel: valoresPorChave.orcamentoDesenvolvimento.responsavel,
      etapaLayoutEm: valoresPorChave.layout.em,
      etapaLayoutResponsavel: valoresPorChave.layout.responsavel,
      etapaAprovacaoEm: valoresPorChave.aprovacao.em,
      etapaAprovacaoResponsavel: valoresPorChave.aprovacao.responsavel,
      etapaConfirmacaoPedidoEm: valoresPorChave.confirmacaoPedido.em,
      etapaConfirmacaoPedidoResponsavel: valoresPorChave.confirmacaoPedido.responsavel,
      etapaEntregaEm: valoresPorChave.entrega.em,
      etapaEntregaResponsavel: valoresPorChave.entrega.responsavel,
    },
  });

  // As etapas não têm gate de status nem trava de campo parcial (ver comentário
  // acima da função) — data e responsável são texto/data livres, editáveis a
  // qualquer momento por qualquer pessoa com acesso ao módulo. Sem isso, uma
  // mudança de "quando entregamos e quem fez" não deixava nenhum rastro.
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "orcamento.editar_etapas",
    entidade: "Orcamento",
    entidadeId: orcamentoId,
    descricao: `Etapas de produção atualizadas no orçamento #${orcamentoId.slice(-6)}`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);

  return { ok: true, mensagem: "Etapas atualizadas." };
}
