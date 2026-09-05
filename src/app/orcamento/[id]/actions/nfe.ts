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

const UNIDADE_FISCAL: Record<string, string> = {
  FOLHA: "FL",
  METRO_QUADRADO: "M2",
  METRO_LINEAR: "M",
  UNIDADE: "UN",
  LITRO: "LT",
  KG: "KG",
  ROLO: "RL",
  PACOTE: "PCT",
  CENTO: "CT",
  MILHEIRO: "MIL",
  HORA: "HR",
};

// unidade === "OUTRO" não tem entrada na tabela acima (é texto livre da
// gráfica, guardado em ItemCatalogo.unidadeOutro) — sem isto, caía sempre no
// fallback genérico "UN", perdendo a unidade real digitada. O campo de
// unidade comercial da NFe aceita texto curto, não precisa ser um código
// oficial de tabela SEFAZ, então um recorte das primeiras letras já resolve.
function resolverUnidadeFiscal(unidade: string | null, unidadeOutro: string | null): string {
  if (unidade === "OUTRO" && unidadeOutro?.trim()) {
    return unidadeOutro.trim().toUpperCase().slice(0, 6);
  }
  return UNIDADE_FISCAL[unidade ?? "UNIDADE"] ?? "UN";
}

// Bifurca no regime tributário da gráfica/filial: Simples Nacional manda só
// o CSOSN (comportamento de sempre, sem os campos novos); Regime Normal
// (Lucro Presumido/Real) manda CST-ICMS + os 4 campos novos. Os `!` são
// seguros porque verificarProntidaoFiscal já bloqueou emitirNotaFiscal antes
// de chegar aqui se algum campo obrigatório do regime estiver faltando.
// icms_base_calculo usa o valor bruto do próprio item — risco assumido
// conscientemente (não modela redução de base de cálculo), documentado no
// plano da feature.
function construirCamposFiscaisItemNfe(
  dadosFiscais: DadosFiscaisResolvidos,
  valorBrutoItem: number
): Pick<
  ItemNfe,
  | "icmsSituacaoTributaria"
  | "icmsAliquota"
  | "icmsBaseCalculo"
  | "icmsModalidadeBaseCalculo"
  | "pisSituacaoTributaria"
  | "cofinsSituacaoTributaria"
> {
  if (dadosFiscais.regimeTributario === "SIMPLES_NACIONAL") {
    return { icmsSituacaoTributaria: dadosFiscais.csosnPadrao };
  }
  return {
    icmsSituacaoTributaria: dadosFiscais.cstIcmsPadrao!,
    icmsAliquota: Number(dadosFiscais.icmsAliquotaPadrao!),
    icmsBaseCalculo: valorBrutoItem,
    icmsModalidadeBaseCalculo: dadosFiscais.icmsModalidadeBaseCalculoPadrao!,
    pisSituacaoTributaria: dadosFiscais.pisCofinsSituacaoTributariaPadrao!,
    cofinsSituacaoTributaria: dadosFiscais.pisCofinsSituacaoTributariaPadrao!,
  };
}

export type EmitirNotaFiscalResult = { ok: boolean; mensagem: string };

// StatusNotaFiscal (schema.prisma) não tem um valor DENEGADO separado — tanto
// erro_autorizacao (Focus NFe rejeitou os dados, HTTP 422) quanto denegado
// (a SEFAZ negou a operação, ex.: destinatário com CNPJ irregular) caem em
// REJEITADA no banco. São problemas diferentes: erro_autorizacao costuma ser
// corrigível ajustando o cadastro; denegado é um bloqueio fiscal do
// destinatário que pode exigir regularização fora do sistema antes de
// reemitir. Prefixamos a mensagem guardada pra que o NotaFiscalCard consiga
// mostrar esse aviso extra sem precisar de uma coluna nova.
const PREFIXO_DENEGADO = "SEFAZ denegou:";

function formatarMensagemErroNfe(resposta: RespostaFocusNfe): string | undefined {
  const mensagem = resposta.mensagemErro ?? resposta.mensagemSefaz;
  if (resposta.status === "denegado") {
    return `${PREFIXO_DENEGADO} ${mensagem ?? "motivo não informado pela SEFAZ."}`;
  }
  return mensagem;
}

// Emite a nota fiscal (NF-e) do orçamento via Focus NFe — cada gráfica usa a
// PRÓPRIA conta/token (ver Configurações → Dados fiscais), nunca uma conta
// nossa. Só chega até aqui depois do usuário clicar "Emitir nota fiscal" no
// NotaFiscalCard — nada disso é pedido proativamente em /comecar ou /login.
export async function emitirNotaFiscal(
  _estadoAnterior: EmitirNotaFiscalResult | null,
  formData: FormData
): Promise<EmitirNotaFiscalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: {
      cliente: true,
      notaFiscal: true,
      itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
    },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "APROVADO") {
    return { ok: false, mensagem: "Só é possível emitir nota fiscal de um orçamento aprovado." };
  }
  if (orcamento.notaFiscal && orcamento.notaFiscal.status !== "REJEITADA") {
    return { ok: false, mensagem: "Este orçamento já tem uma nota fiscal emitida." };
  }
  if (orcamento.notaFiscal) {
    // Nota anterior foi rejeitada (dados inválidos) ou denegada (bloqueio
    // fiscal do destinatário na SEFAZ) — nos dois casos a Focus NFe nunca
    // autorizou a nota, então não sobrou nada fiscal pra preservar aqui.
    // `referencia` é UNIQUE e sempre igual a orcamentoId (ver criação
    // abaixo), então a nota antiga precisa sair antes de tentarmos de novo.
    await prisma.notaFiscal.delete({ where: { id: orcamento.notaFiscal.id } });
  }

  const dadosFiscais = await resolverDadosFiscais(orcamento.filialId, usuario.graficaId);

  const checagem = verificarProntidaoFiscal({
    dadosFiscais,
    cliente: orcamento.cliente,
    itens: orcamento.itens.map((item) => ({
      nome: item.itemGrafica.itemCatalogo.nome,
      ncm: item.itemGrafica.itemCatalogo.ncm,
    })),
  });
  if (!checagem.pronto || !dadosFiscais) {
    return { ok: false, mensagem: checagem.pendencias.join(" ") };
  }

  try {
    const resposta = await emitirNfe(
      { token: dadosFiscais.focusNfeToken!, ambiente: dadosFiscais.ambiente as AmbienteFocusNfe },
      {
        referencia: orcamentoId,
        naturezaOperacao: dadosFiscais.naturezaOperacaoPadrao,
        emitente: {
          cnpj: dadosFiscais.cnpj!,
          nome: dadosFiscais.razaoSocial!,
          nomeFantasia: dadosFiscais.nomeFantasia || dadosFiscais.razaoSocial!,
          inscricaoEstadual: dadosFiscais.inscricaoEstadual ?? "",
          logradouro: dadosFiscais.enderecoLogradouro!,
          numero: dadosFiscais.enderecoNumero!,
          bairro: dadosFiscais.enderecoBairro!,
          municipio: dadosFiscais.enderecoMunicipio!,
          uf: dadosFiscais.enderecoUf!,
          cep: dadosFiscais.enderecoCep!,
        },
        destinatario: {
          documento: orcamento.cliente.documento!,
          nome: orcamento.cliente.nome,
          razaoSocial: orcamento.cliente.razaoSocial,
          indicadorInscricaoEstadual: orcamento.cliente.indicadorInscricaoEstadual,
          inscricaoEstadual: orcamento.cliente.inscricaoEstadual,
          logradouro: orcamento.cliente.enderecoLogradouro!,
          numero: orcamento.cliente.enderecoNumero!,
          bairro: orcamento.cliente.enderecoBairro!,
          municipio: orcamento.cliente.enderecoMunicipio!,
          uf: orcamento.cliente.enderecoUf!,
          cep: orcamento.cliente.enderecoCep!,
        },
        frete: orcamento.frete,
        // Achado F3 da auditoria de abrangência — valor do frete corrigido
        // (antes era "0" fixo, ver resolverValorFrete em src/lib/focus-nfe.ts).
        // null (frete não preenchido) preserva o comportamento de sempre.
        valorFrete: orcamento.valorFrete ? Number(orcamento.valorFrete) : null,
        itens: orcamento.itens.map((item, indice) => {
          const valorBruto = Number(item.precoTotal);
          return {
            numeroItem: indice + 1,
            codigoProduto: item.itemGraficaId,
            descricao: item.descricaoLivre ?? item.itemGrafica.itemCatalogo.nome,
            ncm: item.itemGrafica.itemCatalogo.ncm!,
            origemMercadoria: item.itemGrafica.itemCatalogo.origemMercadoria,
            cfop: resolverCfop({
              ufEmitente: dadosFiscais.enderecoUf,
              ufDestinatario: orcamento.cliente.enderecoUf,
              cfopPadrao: dadosFiscais.cfopPadrao,
              cfopPadraoInterestadual: dadosFiscais.cfopPadraoInterestadual,
              indicadorInscricaoEstadual: orcamento.cliente.indicadorInscricaoEstadual,
            }),
            unidade: resolverUnidadeFiscal(
              item.itemGrafica.itemCatalogo.unidade,
              item.itemGrafica.itemCatalogo.unidadeOutro
            ),
            quantidade: item.quantidade,
            valorUnitario: Number(item.precoUnitario),
            valorBruto,
            ...construirCamposFiscaisItemNfe(dadosFiscais, valorBruto),
          };
        }),
        valorTotal: Number(orcamento.total),
      }
    );

    const statusNota =
      resposta.status === "autorizado"
        ? "AUTORIZADA"
        : resposta.status === "erro_autorizacao" || resposta.status === "denegado"
          ? "REJEITADA"
          : "PROCESSANDO";

    // Transação: cria a NotaFiscal e, se já veio autorizada nesta mesma
    // chamada (a Focus NFe pode responder síncrono), gera as ContaReceber da
    // condição de pagamento com âncora EMISSAO_NOTA (achado R1 da auditoria
    // de abrangência, ver src/lib/condicao-pagamento.ts) — atômico com a
    // criação da nota, nunca uma sem a outra.
    await prisma.$transaction(async (tx) => {
      await tx.notaFiscal.create({
        data: {
          graficaId: usuario.graficaId,
          orcamentoId,
          referencia: orcamentoId,
          status: statusNota,
          numero: resposta.numero,
          serie: resposta.serie,
          chaveAcesso: resposta.chaveNfe,
          xmlUrl: resposta.caminhoXml,
          danfeUrl: resposta.caminhoDanfe,
          mensagemErro: formatarMensagemErroNfe(resposta),
        },
      });

      if (statusNota === "AUTORIZADA") {
        await gerarContasReceberDaEmissaoNota(tx, {
          graficaId: usuario.graficaId,
          orcamentoId,
          clienteId: orcamento.clienteId,
          condicaoPagamentoId: orcamento.condicaoPagamentoId,
          total: Number(orcamento.total),
          emitidoEm: new Date(),
        });
      }
    });
  } catch (erro) {
    if (erro instanceof ErroFocusNfe) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Nota fiscal enviada pra processamento!" };
}

export async function atualizarStatusNotaFiscal(
  _estadoAnterior: EmitirNotaFiscalResult | null,
  formData: FormData
): Promise<EmitirNotaFiscalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const notaFiscal = await prisma.notaFiscal.findFirst({
    where: { orcamentoId, graficaId: usuario.graficaId },
    include: {
      orcamento: { select: { filialId: true, clienteId: true, condicaoPagamentoId: true, total: true } },
    },
  });
  if (!notaFiscal) {
    return { ok: false, mensagem: "Nota fiscal não encontrada." };
  }

  const dadosFiscais = await resolverDadosFiscais(notaFiscal.orcamento.filialId, usuario.graficaId);
  if (!dadosFiscais?.focusNfeToken) {
    return { ok: false, mensagem: "Token da Focus NFe não configurado." };
  }

  try {
    const resposta = await consultarNfe(
      { token: dadosFiscais.focusNfeToken, ambiente: dadosFiscais.ambiente as AmbienteFocusNfe },
      notaFiscal.referencia
    );

    const statusNota =
      resposta.status === "autorizado"
        ? "AUTORIZADA"
        : resposta.status === "cancelado"
          ? "CANCELADA"
          : resposta.status === "erro_autorizacao" || resposta.status === "denegado"
            ? "REJEITADA"
            : "PROCESSANDO";

    // Transação: atualiza o status da nota e, se ela acabou de ser
    // autorizada (a consulta pode ser chamada de novo depois de já
    // AUTORIZADA — nunca dispara duas vezes graças ao marcador de
    // idempotência dentro de gerarContasReceberDaEmissaoNota), gera as
    // ContaReceber com âncora EMISSAO_NOTA. Mesmo padrão de emitirNotaFiscal
    // acima.
    await prisma.$transaction(async (tx) => {
      await tx.notaFiscal.update({
        where: { id: notaFiscal.id },
        data: {
          status: statusNota,
          numero: resposta.numero,
          serie: resposta.serie,
          chaveAcesso: resposta.chaveNfe,
          xmlUrl: resposta.caminhoXml,
          danfeUrl: resposta.caminhoDanfe,
          mensagemErro: formatarMensagemErroNfe(resposta),
        },
      });

      if (statusNota === "AUTORIZADA") {
        await gerarContasReceberDaEmissaoNota(tx, {
          graficaId: usuario.graficaId,
          orcamentoId,
          clienteId: notaFiscal.orcamento.clienteId,
          condicaoPagamentoId: notaFiscal.orcamento.condicaoPagamentoId,
          total: Number(notaFiscal.orcamento.total),
          emitidoEm: new Date(),
        });
      }
    });
  } catch (erro) {
    if (erro instanceof ErroFocusNfe) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Status atualizado." };
}
