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

import { buscarAlcadasDesconto } from "./helpers";

export type CancelarOrcamentoResult = { ok: boolean; mensagem: string };

export async function cancelarOrcamento(
  _estadoAnterior: CancelarOrcamentoResult | null,
  formData: FormData
): Promise<CancelarOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: { itens: { select: { id: true } } },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível cancelar um orçamento em rascunho." };
  }

  // Hard delete: nada foi comunicado ao cliente ainda (rascunho), então não há
  // necessidade de manter um registro "cancelado" — cascade cuida do OrcamentoItem.
  await prisma.orcamento.delete({ where: { id: orcamentoId } });

  // Mesmo cuidado de removerItemOrcamento: o cascade do Prisma apaga
  // OrcamentoItemTinta junto do item, mas não o razão de armazenamento nem o
  // arquivo de verdade no Blob (ArquivoArmazenado só tem relação com
  // Grafica). Melhor esforço, depois do delete confirmado.
  for (const item of orcamento.itens) {
    const arquivoTintaRemovido = await removerArquivo({
      graficaId: usuario.graficaId,
      tipo: "ANALISE_TINTA",
      referenciaId: item.id,
    });
    if (arquivoTintaRemovido) {
      await del(arquivoTintaRemovido.url, { token: exigirTokenBlobPrivado() }).catch(() => {});
    }
  }

  // Achado de auditoria pré-lançamento (2026-08-16): faltava limpar a arte
  // do PRÓPRIO orçamento (ver enviarArteOrcamento/removerArteOrcamento) —
  // sem isso, cancelar um rascunho que já tinha arte anexada deixava o blob
  // público (store diferente do de tinta, por isso sem exigirTokenBlobPrivado
  // aqui, igual removerArteOrcamento) órfão pra sempre e a cota de
  // armazenamento da gráfica reduzida sem volta, porque ArquivoArmazenado só
  // se relaciona com Grafica, não com Orcamento — nada mais no sistema
  // reconhece esse arquivo como órfão depois do delete acima.
  const arquivoArteRemovido = await removerArquivo({
    graficaId: usuario.graficaId,
    tipo: "ARTE_ORCAMENTO",
    referenciaId: orcamentoId,
  });
  if (arquivoArteRemovido) {
    await del(arquivoArteRemovido.url).catch(() => {});
  }

  updateTag(`uso-${usuario.graficaId}`); // orçamento removido muda a contagem do mês (ver src/lib/billing/uso.ts)
  revalidatePath("/orcamento");
  redirect("/orcamento");
}

export type DuplicarOrcamentoResult = { ok: boolean; mensagem: string };

// "Pedir de novo": cria um orçamento NOVO em RASCUNHO com o mesmo cliente e os
// mesmos itens/quantidades/configurações/acabamentos do orçamento de origem —
// só oferecido a partir de APROVADO/REJEITADO (ver OrcamentoAcoes.tsx);
// RASCUNHO/ENVIADO já estão "abertos", duplicar não faz sentido. O vendedor
// ajusta o rascunho gerado (ex: muda quantidade) antes de reenviar.
//
// Preço de cada item é SEMPRE recalculado do zero via calcularItemOrcamento —
// nunca copiado do item antigo — porque matéria-prima pode ter mudado de
// preço desde então (mesmo princípio de "preço nunca confiado do cliente,
// sempre re-derivado no servidor", aplicado aqui ao histórico do próprio
// sistema, não só à entrada de um formulário). Quando o item original tinha
// desconto negociado, o MESMO PERCENTUAL efetivo é reaplicado sobre o novo
// preço sugerido (ver calcularDescontoHerdado em src/lib/orcamento-duplicar.ts)
// — sujeito às duas mesmas travas de aplicarDescontoItemOrcamento (preço
// nunca abaixo do custo direto recalculado; desconto acima do limite da
// gráfica só é aplicado se quem duplicou for DONO/ADMIN). Se qualquer trava
// barrar, o item nasce sem desconto (preço cheio) em vez de abortar a
// duplicação inteira — é só um rascunho, o vendedor decide o resto.
//
// Nunca copiados de propósito: status (sempre nasce RASCUNHO),
// linkPublicoToken, respostaPublica* (aceite/recusa é de UM pedido
// específico), validoAteEm/enviadoEm (validade e data de envio da proposta
// ANTERIOR não se estendem à nova — o duplicado só entra na lista de
// "parados" depois de ser enviado de novo), as etapas de produção
// (etapaXxxEm/Responsavel — começam do zero),
// arteUrl/preflightAvisos (a arte antiga provavelmente não serve pro pedido
// novo — se servir, o vendedor reanexa manualmente) e OrcamentoItemTinta
// (análise de IA sobre a imagem da arte ANTIGA, sem sentido sem ela).
// `observacoes` (nota interna) também fica de fora: em geral descreve
// contexto específico do pedido concluído (ex: "cliente atrasou pagamento"),
// enganoso se herdado sem revisão. `tipoPedido` nasce fixo em
// REPETICAO_SEM_ALTERACAO — é literalmente o que este botão representa.
export async function duplicarOrcamento(
  _estadoAnterior: DuplicarOrcamentoResult | null,
  formData: FormData
): Promise<DuplicarOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra criar orçamentos." };
  }

  const orcamentoId = String(formData.get("orcamentoId"));

  const original = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: {
      itens: {
        include: {
          itemGrafica: { select: { id: true, itemCatalogo: { select: { nome: true } } } },
          acabamentos: true,
          etiqueta: { include: { hotStampings: true } },
          precificacaoEtiqueta: true,
        },
      },
      // Achado A7 — margemPadraoOverride é propriedade do CLIENTE, constante
      // em todo item do orçamento duplicado (mesmo cliente do original, ver
      // DadosItemOrcamento.margemLucroOverride).
      cliente: { select: { margemPadraoOverride: true } },
    },
  });
  if (!original) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (original.status !== "APROVADO" && original.status !== "REJEITADO") {
    return {
      ok: false,
      mensagem: "Só é possível pedir de novo a partir de um orçamento aprovado ou rejeitado.",
    };
  }
  if (original.itens.length === 0) {
    return { ok: false, mensagem: "Este orçamento não tem itens pra duplicar." };
  }
  const margemLucroOverride =
    original.cliente.margemPadraoOverride !== null ? Number(original.cliente.margemPadraoOverride) : null;

  const parametros = await prisma.parametrosGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
    select: { descontoMaxSemAprovacao: true, pedidoMinimo: true, incrementoArredondamento: true },
  });
  const limiteDescontoSemAprovacao = parametros
    ? paraDecimal(parametros.descontoMaxSemAprovacao.toString())
    : paraDecimal(100);
  // Achado N3 — pedido duplicado também precisa do piso de pedido aplicado
  // uma vez sobre a soma dos itens, mesma regra de criarOrcamento (ver
  // aplicarPisoDoPedido em src/lib/pricing/compor.ts).
  const pedidoMinimo = paraDecimal(parametros?.pedidoMinimo.toString() ?? "0");
  const incrementoArredondamento = paraDecimal(parametros?.incrementoArredondamento.toString() ?? "0.10");
  // Achado A4 da auditoria de abrangência — mesma resolução de
  // aplicarDescontoItemOrcamento: limite RESOLVIDO pra este usuário
  // (alçada dele > alçada do papel dele > fallback idêntico ao
  // comportamento de sempre), usado abaixo pra decidir se o desconto
  // herdado pode ser aplicado sem mais ninguém.
  const alcadasDesconto = await buscarAlcadasDesconto(usuario.graficaId);
  const limiteDescontoResolvido = paraDecimal(
    resolverLimiteDesconto(usuario, alcadasDesconto, Number(limiteDescontoSemAprovacao))
  );

  let total = paraDecimal(0);
  const itensParaCriar: {
    itemGraficaId: string;
    quantidade: number;
    larguraCm: Prisma.Decimal | null;
    alturaCm: Prisma.Decimal | null;
    // Achado F7 — copiados direto do item original (mesmo padrão de
    // larguraCm/alturaCm acima), nunca passam por montarDadosItemParaRecalculo
    // nem calcularItemOrcamento — motor de preço nunca viu esses campos.
    profundidadeCm: Prisma.Decimal | null;
    espessuraMm: Prisma.Decimal | null;
    unidadeDimensao: (typeof UNIDADES_DIMENSAO)[number];
    cores: string | null;
    acabamento: string | null;
    descricaoLivre: string | null;
    precoUnitario: string;
    precoTotal: string;
    precoSugeridoUnitario: string;
    descontoTipo: "PERCENTUAL" | null;
    descontoValor: string | null;
    motivoDesconto: string | null;
    aprovadoPorId: string | null;
    modeloCalculo:
      | "SIMPLES"
      | "M2"
      | "OFFSET"
      | "FLEXOGRAFIA"
      | "DIGITAL"
      | "SERIGRAFIA"
      | "SUBLIMACAO"
      | "ESTAMPAGEM_QUENTE"
      | "PERSONALIZACAO"
      | "REVENDA"
      | "BORDADO"
      | "TEMPO_MAQUINA"
      | "DTF";
    corFrente: number | null;
    corVerso: number | null;
    numeroCoresFlexo: number | null;
    numeroCliques: number | null;
    numeroSetups: number | null;
    prazoEstimadoDias: number | null;
    numeroPontos: number | null;
    tempoEstimadoMin: number | null;
    metrosCorte: number | null;
    horasEstimadas: number | null;
    custoAquisicaoUnitario: number | null;
    // Achado N10 — ver comentário em ResultadoItemOrcamento.custoFaca
    // (src/lib/orcamento-precificacao.ts).
    custoFaca: number | null;
    materialFornecidoPeloCliente: boolean;
    breakdown: Prisma.InputJsonValue | null;
    etiqueta: (typeof original.itens)[number]["etiqueta"];
    acabamentosParaGravar: { itemGraficaId: string; qtdBase: string; custoCalculado: string }[];
    precificacaoEtiquetaParaGravar: {
      papelId: string;
      quantidadeCores: number;
      custoClicheCalculado: string;
      custoFaca: string | null;
      custoFrete: string | null;
    } | null;
  }[] = [];

  for (const [indice, itemOriginal] of original.itens.entries()) {
    const nomeItem = itemOriginal.itemGrafica.itemCatalogo.nome;

    // Refetch: nunca confia no ItemGrafica carregado junto do orçamento
    // antigo — o produto pode ter sido desativado ou perdido o preço desde
    // então (mesmo cuidado de adicionarItemOrcamento/criarOrcamento).
    const itemGraficaFresh = await prisma.itemGrafica.findFirst({
      where: { id: itemOriginal.itemGraficaId, graficaId: usuario.graficaId, ativo: true },
    });
    if (!itemGraficaFresh) {
      return {
        ok: false,
        mensagem: `Item ${indice + 1} ("${nomeItem}"): produto ou serviço não está mais disponível no catálogo — remova este item do orçamento original ou reative o produto antes de pedir de novo.`,
      };
    }
    if (!itemGraficaFresh.precoVenda) {
      return {
        ok: false,
        mensagem: `Item ${indice + 1} ("${nomeItem}"): está sem preço de venda configurado no catálogo — configure o preço antes de pedir de novo.`,
      };
    }

    const dados = montarDadosItemParaRecalculo({
      quantidade: itemOriginal.quantidade,
      larguraCm: itemOriginal.larguraCm,
      alturaCm: itemOriginal.alturaCm,
      corFrente: itemOriginal.corFrente,
      corVerso: itemOriginal.corVerso,
      numeroCoresFlexo: itemOriginal.numeroCoresFlexo,
      numeroCliques: itemOriginal.numeroCliques,
      numeroSetups: itemOriginal.numeroSetups,
      numeroPontos: itemOriginal.numeroPontos,
      tempoEstimadoMin: itemOriginal.tempoEstimadoMin,
      metrosCorte: itemOriginal.metrosCorte,
      horasEstimadas: itemOriginal.horasEstimadas,
      custoAquisicaoUnitario: itemOriginal.custoAquisicaoUnitario,
      custoFaca: itemOriginal.custoFaca,
      materialFornecidoPeloCliente: itemOriginal.materialFornecidoPeloCliente,
      acabamentos: itemOriginal.acabamentos,
      precificacaoEtiqueta: itemOriginal.precificacaoEtiqueta,
    }, margemLucroOverride);

    const resultado = await calcularItemOrcamento(itemGraficaFresh, usuario.graficaId, dados);
    if (!resultado.ok) {
      return { ok: false, mensagem: `Item ${indice + 1} ("${nomeItem}"): ${resultado.mensagem}` };
    }

    let precoUnitario = paraDecimal(resultado.precoUnitario);
    let precoTotal = paraDecimal(resultado.precoTotal);
    let descontoTipo: "PERCENTUAL" | null = null;
    let descontoValor: string | null = null;
    let motivoDesconto: string | null = null;
    let aprovadoPorId: string | null = null;

    if (itemOriginal.descontoTipo && itemOriginal.precoSugeridoUnitario) {
      const herdado = calcularDescontoHerdado({
        precoSugeridoOriginal: itemOriginal.precoSugeridoUnitario.toString(),
        precoUnitarioOriginalComDesconto: itemOriginal.precoUnitario.toString(),
        novoPrecoSugeridoUnitario: resultado.precoUnitario,
        quantidade: itemOriginal.quantidade,
      });

      if (herdado) {
        // Mesma trava de preço mínimo de aplicarDescontoItemOrcamento: nunca
        // vende abaixo do custo direto deste item, já recalculado.
        const breakdown = resultado.breakdown as { custoTotal?: string } | null;
        // Achado N11(b) — mesma área usada no recálculo do PREÇO deste item
        // (itemOriginal.larguraCm/alturaCm, já passadas pra
        // montarDadosItemParaRecalculo acima) aplicada ao CUSTO também,
        // quando o produto SIMPLES cobra por m².
        const areaM2 =
          itemGraficaFresh.simplesCobraPorArea && itemOriginal.larguraCm && itemOriginal.alturaCm
            ? (Number(itemOriginal.larguraCm) / 100) * (Number(itemOriginal.alturaCm) / 100)
            : 1;
        // Achado N11(a) — precoCompra ausente é custo DESCONHECIDO, não zero
        // (mesmo raciocínio de aplicarDescontoItemOrcamento): usa o preço
        // sugerido recalculado (sem desconto) como piso em vez de liberar o
        // desconto herdado irrestrito.
        const custoDiretoNumero = breakdown?.custoTotal
          ? Number(breakdown.custoTotal)
          : itemGraficaFresh.precoCompra
            ? Number(itemGraficaFresh.precoCompra) * itemOriginal.quantidade * areaM2
            : Number(resultado.precoTotal);
        const custoDireto = paraDecimal(custoDiretoNumero);

        // Mesma trava de aprovação de aplicarDescontoItemOrcamento: desconto
        // acima do limite RESOLVIDO pra quem está duplicando (achado A4 da
        // auditoria de abrangência) simplesmente não é herdado. Não há como
        // pedir aprovação no meio de uma criação automática — se quem
        // duplicou não tem alçada suficiente, o item nasce sem desconto
        // (preço cheio) em vez de bloquear a duplicação inteira.
        const podeHerdarDesconto = herdado.percentual.lte(limiteDescontoResolvido);
        const precisaAprovacao = herdado.percentual.gt(limiteDescontoSemAprovacao);

        if (herdado.precoTotal.gte(custoDireto) && podeHerdarDesconto) {
          precoUnitario = herdado.precoUnitario;
          precoTotal = herdado.precoTotal;
          descontoTipo = "PERCENTUAL";
          descontoValor = herdado.percentual.toFixed(4);
          motivoDesconto = itemOriginal.motivoDesconto
            ? `${itemOriginal.motivoDesconto} (herdado do orçamento original)`
            : "Desconto herdado do orçamento original";
          aprovadoPorId = precisaAprovacao ? usuario.id : null;
        }
      }
    }

    total = total.plus(precoTotal);

    itensParaCriar.push({
      itemGraficaId: itemGraficaFresh.id,
      quantidade: itemOriginal.quantidade,
      larguraCm: itemOriginal.larguraCm,
      alturaCm: itemOriginal.alturaCm,
      profundidadeCm: itemOriginal.profundidadeCm,
      espessuraMm: itemOriginal.espessuraMm,
      unidadeDimensao: itemOriginal.unidadeDimensao,
      cores: itemOriginal.cores,
      acabamento: itemOriginal.acabamento,
      descricaoLivre: itemOriginal.descricaoLivre,
      precoUnitario: precoUnitario.toFixed(2),
      precoTotal: precoTotal.toFixed(2),
      precoSugeridoUnitario: resultado.precoUnitario,
      descontoTipo,
      descontoValor,
      motivoDesconto,
      aprovadoPorId,
      modeloCalculo: resultado.modeloCalculo,
      corFrente: resultado.corFrente,
      corVerso: resultado.corVerso,
      numeroCoresFlexo: resultado.numeroCoresFlexo,
      numeroCliques: resultado.numeroCliques,
      numeroSetups: resultado.numeroSetups,
      prazoEstimadoDias: itemOriginal.prazoEstimadoDias,
      numeroPontos: resultado.numeroPontos,
      tempoEstimadoMin: resultado.tempoEstimadoMin,
      metrosCorte: resultado.metrosCorte,
      horasEstimadas: resultado.horasEstimadas,
      custoAquisicaoUnitario: resultado.custoAquisicaoUnitario,
      custoFaca: resultado.custoFaca,
      materialFornecidoPeloCliente: resultado.materialFornecidoPeloCliente,
      breakdown: resultado.breakdown ?? null,
      etiqueta: itemOriginal.etiqueta,
      acabamentosParaGravar: resultado.acabamentos,
      precificacaoEtiquetaParaGravar: resultado.precificacaoEtiqueta,
    });
  }

  // Achado N3 — piso de pedido aplicado uma vez sobre a soma dos itens
  // duplicados, mesma regra de criarOrcamento (ver aplicarPisoDoPedido).
  total = aplicarPisoDoPedido(total, pedidoMinimo, incrementoArredondamento);

  const novoOrcamento = await prisma.orcamento.create({
    data: {
      graficaId: usuario.graficaId,
      clienteId: original.clienteId,
      usuarioId: usuario.id,
      filialId: original.filialId,
      duplicadoDeId: original.id,
      total: total.toFixed(2),
      vendedor: original.vendedor,
      tipoPedido: "REPETICAO_SEM_ALTERACAO",
      contatoNome: original.contatoNome,
      contatoEmail: original.contatoEmail,
      condicoesPagamento: original.condicoesPagamento,
      frete: original.frete,
      transportadora: original.transportadora,
      // transportadoraId/valorFrete (achado F3) NÃO são copiados de
      // propósito — mesmo critério que já deixa contatoClienteId/
      // enderecoEntregaId de fora desta duplicação (só embaixo, no fetch
      // de `original`, ver a query acima): valorFrete é um valor NEGOCIADO
      // daquele pedido específico, não deveria "vazar" silenciosamente pra
      // um pedido novo que ainda nem foi cotado de novo. `transportadora`
      // (texto livre) continua copiado normalmente — é só um snapshot
      // descritivo, sem valor financeiro associado.
      localEntrega: original.localEntrega,
      itens: {
        create: itensParaCriar.map((item) => ({
          itemGraficaId: item.itemGraficaId,
          quantidade: item.quantidade,
          larguraCm: item.larguraCm,
          alturaCm: item.alturaCm,
          profundidadeCm: item.profundidadeCm,
          espessuraMm: item.espessuraMm,
          unidadeDimensao: item.unidadeDimensao,
          cores: item.cores,
          acabamento: item.acabamento,
          descricaoLivre: item.descricaoLivre,
          precoUnitario: item.precoUnitario,
          precoTotal: item.precoTotal,
          precoSugeridoUnitario: item.precoSugeridoUnitario,
          descontoTipo: item.descontoTipo,
          descontoValor: item.descontoValor,
          motivoDesconto: item.motivoDesconto,
          aprovadoPorId: item.aprovadoPorId,
          modeloCalculo: item.modeloCalculo,
          corFrente: item.corFrente,
          corVerso: item.corVerso,
          numeroCoresFlexo: item.numeroCoresFlexo,
          numeroCliques: item.numeroCliques,
          numeroSetups: item.numeroSetups,
          prazoEstimadoDias: item.prazoEstimadoDias,
          numeroPontos: item.numeroPontos,
          tempoEstimadoMin: item.tempoEstimadoMin,
          metrosCorte: item.metrosCorte,
          horasEstimadas: item.horasEstimadas,
          custoAquisicaoUnitario: item.custoAquisicaoUnitario,
          custoFaca: item.custoFaca,
          materialFornecidoPeloCliente: item.materialFornecidoPeloCliente,
          breakdown: item.breakdown ?? undefined,
          // Descritivo de produção (nunca entra na conta de preço, ver
          // OrcamentoItemEtiqueta no schema) — copiado literalmente do item
          // original quando M2, mesmo padrão de "sempre cria a linha pra
          // item M2" de criarOrcamento (evita "M2 sem etiqueta" como estado
          // possível no resto do código).
          etiqueta:
            item.modeloCalculo === "M2"
              ? {
                  create: {
                    materialSubstrato: item.etiqueta?.materialSubstrato ?? null,
                    materialSubstratoOutro: item.etiqueta?.materialSubstratoOutro ?? null,
                    tipoAdesivo: item.etiqueta?.tipoAdesivo ?? null,
                    tipoAdesivoOutro: item.etiqueta?.tipoAdesivoOutro ?? null,
                    durabilidadeAdesivo: item.etiqueta?.durabilidadeAdesivo ?? null,
                    superficieAplicacao: item.etiqueta?.superficieAplicacao ?? null,
                    superficieAplicacaoOutro: item.etiqueta?.superficieAplicacaoOutro ?? null,
                    formatoEtiqueta: item.etiqueta?.formatoEtiqueta ?? null,
                    coresRotulo: item.etiqueta?.coresRotulo ?? null,
                    coresContraRotulo: item.etiqueta?.coresContraRotulo ?? null,
                    embalagemQtdPorRolo: item.etiqueta?.embalagemQtdPorRolo ?? null,
                    tubeteMedida: item.etiqueta?.tubeteMedida ?? null,
                    rotulagem: item.etiqueta?.rotulagem ?? null,
                    serrilha: item.etiqueta?.serrilha ?? null,
                    serrilhaOutro: item.etiqueta?.serrilhaOutro ?? null,
                    vernizRotuloTotal: item.etiqueta?.vernizRotuloTotal ?? false,
                    vernizRotuloReserva: item.etiqueta?.vernizRotuloReserva ?? false,
                    vernizRotuloTipo: item.etiqueta?.vernizRotuloTipo ?? null,
                    vernizRotuloTipoOutro: item.etiqueta?.vernizRotuloTipoOutro ?? null,
                    vernizContraRotuloTotal: item.etiqueta?.vernizContraRotuloTotal ?? false,
                    vernizContraRotuloReserva: item.etiqueta?.vernizContraRotuloReserva ?? false,
                    vernizContraRotuloTipo: item.etiqueta?.vernizContraRotuloTipo ?? null,
                    vernizContraRotuloTipoOutro: item.etiqueta?.vernizContraRotuloTipoOutro ?? null,
                    laminacaoRotulo: item.etiqueta?.laminacaoRotulo ?? null,
                    laminacaoRotuloOutro: item.etiqueta?.laminacaoRotuloOutro ?? null,
                    laminacaoContraRotulo: item.etiqueta?.laminacaoContraRotulo ?? null,
                    laminacaoContraRotuloOutro: item.etiqueta?.laminacaoContraRotuloOutro ?? null,
                    rebobinamento: item.etiqueta?.rebobinamento ?? null,
                    hotStampings: {
                      create: (item.etiqueta?.hotStampings ?? []).map((h) => ({
                        lado: h.lado,
                        tipo: h.tipo,
                        tipoOutro: h.tipoOutro || null,
                        tipoEfeitoHotStamping: h.tipoEfeitoHotStamping || null,
                        medida: h.medida || null,
                        cor: h.cor || null,
                      })),
                    },
                  },
                }
              : undefined,
          acabamentos:
            item.acabamentosParaGravar.length > 0
              ? {
                  create: item.acabamentosParaGravar.map((a) => ({
                    itemGraficaId: a.itemGraficaId,
                    qtdBase: a.qtdBase,
                    custoCalculado: a.custoCalculado,
                  })),
                }
              : undefined,
          precificacaoEtiqueta: item.precificacaoEtiquetaParaGravar
            ? {
                create: {
                  papelId: item.precificacaoEtiquetaParaGravar.papelId,
                  quantidadeCores: item.precificacaoEtiquetaParaGravar.quantidadeCores,
                  custoClicheCalculado: item.precificacaoEtiquetaParaGravar.custoClicheCalculado,
                  custoFaca: item.precificacaoEtiquetaParaGravar.custoFaca,
                  custoFrete: item.precificacaoEtiquetaParaGravar.custoFrete,
                },
              }
            : undefined,
        })),
      },
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "orcamento.duplicar",
    entidade: "Orcamento",
    entidadeId: novoOrcamento.id,
    descricao: `Pediu de novo a partir do orçamento #${original.id.slice(-6)} — criou o orçamento #${novoOrcamento.id.slice(-6)} em rascunho, ${itensParaCriar.length} ${itensParaCriar.length === 1 ? "item" : "itens"}, total recalculado em ${formatoMoeda.format(total.toNumber())}.`,
  });

  updateTag(`uso-${usuario.graficaId}`); // orçamento novo muda a contagem do mês (ver src/lib/billing/uso.ts)
  revalidatePath("/orcamento");
  redirect(`/orcamento/${novoOrcamento.id}`);
}

export type GerarLinkResult = { ok: boolean; mensagem: string; url?: string };

export async function gerarLinkPublico(
  _estadoAnterior: GerarLinkResult | null,
  formData: FormData
): Promise<GerarLinkResult> {
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

  let token = orcamento.linkPublicoToken;
  if (!token) {
    token = randomBytes(20).toString("base64url");
    await prisma.orcamento.update({
      where: { id: orcamentoId },
      data: { linkPublicoToken: token },
    });
  }

  // Gerar (ou já ter gerado) o link é o próprio ato de "mandar pro cliente"
  // nesta tela — o botão que chama esta action fica dentro do card
  // "Compartilhar com o cliente", seguido de copiar/WhatsApp, nunca de um
  // fluxo de pré-visualização separado. Sem isto, dava pra gerar o link,
  // mandar de verdade pro cliente, e ele abrir um orçamento ainda em
  // RASCUNHO — onde TRANSICOES_VALIDAS só libera responder a partir de
  // ENVIADO, e a página pública não tinha nenhum botão nem explicação (ver
  // o/[token]/page.tsx). Só transiciona a partir de RASCUNHO — se já estiver
  // ENVIADO/APROVADO/REJEITADO, devolve o link sem mexer no status. CAS
  // (mesmo padrão do resto do arquivo) pra não pisar numa transição
  // concorrente, ex: vendedor gerando o link enquanto outra aba já avançou
  // o status por outro caminho.
  if (TRANSICOES_VALIDAS[orcamento.status as StatusOrcamento]?.includes("ENVIADO")) {
    const parametros = await prisma.parametrosGrafica.findUnique({
      where: { graficaId: usuario.graficaId },
      select: { diasValidadeOrcamentoPadrao: true, toleranciaTiragemPadraoPercent: true },
    });
    await prisma.orcamento.updateMany({
      where: { id: orcamentoId, status: orcamento.status },
      data: {
        status: "ENVIADO",
        validoAteEm: new Date(
          Date.now() + (parametros?.diasValidadeOrcamentoPadrao ?? 15) * 86_400_000
        ),
        // Âncora da lista de "orçamentos parados" (ver orcamentoEstaParado
        // em src/lib/orcamento-status.ts) — mesmo campo setado em
        // atualizarStatusOrcamento acima, só um dos dois caminhos roda por
        // transição.
        enviadoEm: new Date(),
        // Mesmo snapshot de tolerância de tiragem que atualizarStatusOrcamento
        // faz acima — só um dos dois caminhos roda por transição.
        toleranciaTiragemPercent: parametros?.toleranciaTiragemPadraoPercent ?? 10,
      },
    });
    revalidatePath("/orcamento");
  }

  const url = `${await resolverOrigemPublica()}/o/${token}`;

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Link gerado!", url };
}

// O link público não expira nem some sozinho — desde a feature de orçamento
// completo ele passou a expor a ficha técnica inteira da etiqueta, não só
// preço/itens. Gera um token novo em vez de reaproveitar (revogado de
// verdade, não só "escondido"); se a gráfica quiser compartilhar de novo,
// gerarLinkPublico cria outro token do zero.
export async function revogarLinkPublico(
  _estadoAnterior: GerarLinkResult | null,
  formData: FormData
): Promise<GerarLinkResult> {
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

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { linkPublicoToken: null },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "orcamento.revogar_link",
    entidade: "Orcamento",
    entidadeId: orcamentoId,
    descricao: `Link público revogado do orçamento #${orcamentoId.slice(-6)}`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Link revogado — quem tinha o link anterior não acessa mais." };
}

export type RenovarValidadeResult = { ok: boolean; mensagem: string };

// Único jeito de "destravar" um orçamento ENVIADO vencido sem reabrir pra
// RASCUNHO (isso perderia o link já compartilhado — ver comentário de
// TRANSICOES_VALIDAS) — só empurra validoAteEm pra frente, status e o resto
// do orçamento continuam intactos. Sem CAS de status porque não muda status.
export async function renovarValidadeOrcamento(
  _estadoAnterior: RenovarValidadeResult | null,
  formData: FormData
): Promise<RenovarValidadeResult> {
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
  if (orcamento.status !== "ENVIADO") {
    return { ok: false, mensagem: "Só é possível renovar a validade de um orçamento enviado." };
  }

  const parametros = await prisma.parametrosGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
    select: { diasValidadeOrcamentoPadrao: true },
  });
  const validoAteEm = new Date(
    Date.now() + (parametros?.diasValidadeOrcamentoPadrao ?? 15) * 86_400_000
  );

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { validoAteEm },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "orcamento.renovar_validade",
    entidade: "Orcamento",
    entidadeId: orcamentoId,
    descricao: `Validade do orçamento #${orcamentoId.slice(-6)} renovada até ${formatoInstanteReal.format(validoAteEm)}`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);

  return { ok: true, mensagem: "Validade renovada." };
}
