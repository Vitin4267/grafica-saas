"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import { put, del } from "@vercel/blob";
import { exigirTokenBlobPrivado } from "@/lib/blob-assinado";
import { prisma, transacaoComTenant } from "@/lib/prisma";
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
  quantidadeRestanteParaFaturar,
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
      itens: {
        include: {
          itemGrafica: { include: { itemCatalogo: true } },
          // Feature de nota fiscal PARCIAL (2026-09-22) — pra calcular
          // quanto de cada item já foi faturado (ver
          // quantidadeRestanteParaFaturar em src/lib/nota-fiscal.ts), só o
          // status da nota de cada NotaFiscalItem importa aqui (REJEITADA/
          // CANCELADA liberam a quantidade de volta).
          notaFiscalItens: { include: { notaFiscal: { select: { status: true } } } },
        },
      },
    },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "APROVADO") {
    return { ok: false, mensagem: "Só é possível emitir nota fiscal de um orçamento aprovado." };
  }

  // Feature de nota fiscal PARCIAL (2026-09-22) — cada item pode entrar
  // nesta nota com uma quantidade de 0 até o restante a faturar (campo
  // `quantidade_${orcamentoItemId}` no FormData, vazio/0 = item de fora
  // desta nota). Validação DURA (não "com observação" como o recebimento
  // parcial de compras) — nota fiscal é documento fiscal de verdade, pedir
  // mais do que resta nunca é uma divergência aceitável, é errado.
  const itensSelecionados: {
    item: (typeof orcamento.itens)[number];
    quantidade: Dec;
  }[] = [];
  for (const item of orcamento.itens) {
    const bruto = formData.get(`quantidade_${item.id}`);
    const texto = bruto === null ? "" : String(bruto).trim();
    if (!texto) continue;
    const numero = Number(texto);
    if (!Number.isFinite(numero) || numero <= 0) continue;

    const restante = quantidadeRestanteParaFaturar(item);
    const solicitada = paraDecimal(numero);
    const nomeItem = item.descricaoLivre ?? item.itemGrafica.itemCatalogo.nome;
    if (solicitada.gt(restante)) {
      return {
        ok: false,
        mensagem: `Quantidade pedida de "${nomeItem}" (${solicitada.toFixed(4)}) é maior que o restante a faturar (${restante.toFixed(4)}).`,
      };
    }
    itensSelecionados.push({ item, quantidade: solicitada });
  }
  if (itensSelecionados.length === 0) {
    return { ok: false, mensagem: "Selecione ao menos um item com quantidade pra faturar." };
  }

  const dadosFiscais = await resolverDadosFiscais(orcamento.filialId, usuario.graficaId);

  const checagem = verificarProntidaoFiscal({
    dadosFiscais,
    cliente: orcamento.cliente,
    itens: itensSelecionados.map(({ item }) => ({
      nome: item.itemGrafica.itemCatalogo.nome,
      ncm: item.itemGrafica.itemCatalogo.ncm,
    })),
  });
  if (!checagem.pronto || !dadosFiscais) {
    return { ok: false, mensagem: checagem.pendencias.join(" ") };
  }

  // Referência mandada pra Focus NFe — precisa variar por nota agora que um
  // orçamento pode ter várias NFE (antes era sempre === orcamentoId,
  // garantido único pelo índice único que existia em (orcamentoId, modelo)
  // — removido nesta mesma feature). `referencia` continua @unique no
  // banco: uma colisão aqui (corrida entre duas emissões simultâneas lendo
  // a mesma contagem) faz a transação abaixo falhar com erro claro em vez
  // de sobrescrever silenciosamente, e o usuário só tenta de novo.
  const referencia = `${orcamentoId}-${orcamento.notaFiscal.length + 1}`;

  const valorTotalSelecionado = itensSelecionados.reduce(
    (soma, { item, quantidade }) => soma.plus(paraDecimal(item.precoUnitario.toString()).times(quantidade)),
    paraDecimal(0)
  );

  try {
    const resposta = await emitirNfe(
      { token: dadosFiscais.focusNfeToken!, ambiente: dadosFiscais.ambiente as AmbienteFocusNfe },
      {
        referencia,
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
        // Feature de nota fiscal PARCIAL (2026-09-22) — só os itens
        // selecionados nesta nota, com a quantidade PEDIDA (não a
        // quantidade total do item) e o valor bruto recalculado em cima
        // dela (preço unitário nunca muda, só a quantidade faturada agora).
        itens: itensSelecionados.map(({ item, quantidade }, indice) => {
          const valorUnitarioDec = paraDecimal(item.precoUnitario.toString());
          const valorBrutoDec = valorUnitarioDec.times(quantidade);
          const valorBruto = valorBrutoDec.toNumber();
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
            quantidade: quantidade.toNumber(),
            valorUnitario: valorUnitarioDec.toNumber(),
            valorBruto,
            ...construirCamposFiscaisItemNfe(dadosFiscais, valorBruto),
          };
        }),
        valorTotal: valorTotalSelecionado.toNumber(),
      }
    );

    const statusNota =
      resposta.status === "autorizado"
        ? "AUTORIZADA"
        : resposta.status === "erro_autorizacao" || resposta.status === "denegado"
          ? "REJEITADA"
          : "PROCESSANDO";

    // Transação: cria a NotaFiscal + NotaFiscalItem e, se já veio autorizada
    // nesta mesma chamada (a Focus NFe pode responder síncrono), gera as
    // ContaReceber da condição de pagamento com âncora EMISSAO_NOTA (achado
    // R1 da auditoria de abrangência, ver src/lib/condicao-pagamento.ts) —
    // atômico com a criação da nota, nunca uma sem a outra.
    await transacaoComTenant(async (tx) => {
      // Feature de nota fiscal PARCIAL (2026-09-22) — decidido DE PROPÓSITO
      // não reconferir o saldo aqui dentro, depois de emitirNfe já ter
      // rodado acima: se a Focus NFe já autorizou a nota nesta chamada, ela
      // é um documento fiscal REAL — travar aqui e jogar um erro perderia o
      // registro local de uma nota que já existe de verdade na SEFAZ, o que
      // é bem pior do que o risco que essa reconferência evitaria (duas
      // emissões simultâneas do mesmo item, cenário raro pra um único
      // operador por orçamento). A checagem que já rodou antes de chamar
      // emitirNfe (usando quantidadeRestanteParaFaturar) é a proteção real;
      // aqui só grava o que a Focus NFe já processou.
      const notaCriada = await tx.notaFiscal.create({
        data: {
          graficaId: usuario.graficaId,
          orcamentoId,
          // Achado F2 da auditoria de abrangência — explícito mesmo já
          // sendo o @default(NFE) do schema: esta Server Action só emite
          // NF-e (emissão de NFS-e é fase 2, fora de escopo desta rodada).
          modelo: "NFE",
          referencia,
          status: statusNota,
          numero: resposta.numero,
          serie: resposta.serie,
          chaveAcesso: resposta.chaveNfe,
          xmlUrl: resposta.caminhoXml,
          danfeUrl: resposta.caminhoDanfe,
          mensagemErro: formatarMensagemErroNfe(resposta),
        },
      });

      await tx.notaFiscalItem.createMany({
        data: itensSelecionados.map(({ item, quantidade }) => {
          const precoUnitario = paraDecimal(item.precoUnitario.toString());
          return {
            notaFiscalId: notaCriada.id,
            orcamentoItemId: item.id,
            quantidade: quantidade.toFixed(4),
            precoUnitario: precoUnitario.toFixed(4),
            precoTotal: precoUnitario.times(quantidade).toFixed(4),
          };
        }),
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
  // Feature de nota fiscal PARCIAL (2026-09-22) — orcamentoId sozinho não
  // identifica mais uma nota única (um orçamento pode ter várias NFE, além
  // de uma eventual NFSE numa venda mista). A tela agora tem um botão
  // "Atualizar status" por nota da lista, cada um mandando o próprio id.
  const notaFiscalId = String(formData.get("notaFiscalId"));

  const notaFiscal = await prisma.notaFiscal.findFirst({
    where: { id: notaFiscalId, orcamentoId, graficaId: usuario.graficaId, modelo: "NFE" },
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
    await transacaoComTenant(async (tx) => {
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
