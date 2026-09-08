import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { MotivoRefugo, StatusPedido } from "@/generated/prisma/enums";
import { D } from "@/lib/pricing/decimal";
import { buscarAutomacaoGrafica, dispararEventoAutomacao } from "@/lib/webhook-automacao";
import { normalizarTelefone } from "@/lib/telefone";
import { cruzouLimiteMinimo } from "@/lib/estoque-critico";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { parseJsonArray } from "@/lib/form-json";
import {
  montarChavePerda,
  resolverPerdasConfirmadas,
  calcularEstoqueDepois,
  validarEstoqueSuficiente,
  chaveFisicaMaterial,
} from "@/lib/perda-fixa-producao";
import {
  calcularBaixaRefugoLinha,
  refugoGeraCustoAutomatico,
  ROTULOS_MOTIVO_REFUGO,
  type RefugoInput,
} from "@/lib/refugo-producao";
import {
  fecharEAbrirApontamento,
  type ContextoOrigemAvanco,
  type RefugoParaFechamento,
} from "@/lib/apontamento-etapa";
import { gerarContasReceberDaEntrega } from "@/lib/condicao-pagamento";
import { resolverEtapasGrafica } from "@/lib/etapa-grafica";
import { calcularQuantidadeConsumidaFichaProduto } from "@/lib/baixa-estoque-substrato";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateEstagioResponsavel } from "@/lib/email/templates";

// Núcleo compartilhado da transição de status de um Pedido — usado tanto
// por avancarPedido (autenticado, src/app/producao/actions.ts) quanto por
// confirmarEstagioPublico (sem login, src/app/p/[token]/actions.ts). NÃO
// faz autenticação/autorização — cada chamador decide separadamente se
// pode chamar isso; o que acontece depois de decidido é idêntico nos dois
// casos (CAS + baixa de estoque condicional + webhook de automação +
// e-mail aos responsáveis da PRÓXIMA etapa + revalidatePath).

export type PedidoParaAvanco = {
  id: string;
  graficaId: string;
  orcamentoId: string;
  status: StatusPedido;
  arteUrl: string | null;
  arteAprovadaEm: Date | null;
  producaoLinkToken: string | null;
  orcamento: {
    // Achado R1 da auditoria de abrangência (Parte 7, 2026-09-03) — gatilho
    // ENTREGA de gerarContasReceberDaEntrega precisa desses 3 campos (ver
    // uso mais abaixo, na transição pra ENTREGUE). Sempre presentes na
    // prática: um `include` do Prisma sem `select` (todos os call-sites de
    // avancarStatusPedido) já traz os escalares do Orcamento de graça, não é
    // uma query nova.
    clienteId: string;
    condicaoPagamentoId: string | null;
    total: Prisma.Decimal | number;
    cliente: { nome: string; telefone: string | null };
    grafica: { nome: string; corPrimaria: string | null };
    itens: { quantidade: number; itemGrafica: { itemCatalogo: { nome: string } } }[];
  };
};

export type AvancarStatusResult =
  | { ok: true; mensagem: string; statusAnterior: StatusPedido; proximoStatus: StatusPedido }
  | { ok: false; mensagem: string };

const MENSAGEM_CONFLITO_CONCORRENTE =
  "Outra pessoa já avançou este pedido — recarregue a página e confira o status atual.";

// Distinta de MENSAGEM_CONFLITO_CONCORRENTE de propósito: a leitura da ficha
// técnica/estoque roda FORA da transação Serializable (mantém a transação
// curta), então um erro de serialização aqui normalmente não é sobre ESTE
// pedido — é o Postgres abortando porque outro pedido, avançado ao mesmo
// tempo, mexeu no estoque do MESMO material físico (papel, chapa etc.)
// compartilhado entre os dois. Devolver a mensagem de "outra pessoa avançou
// este pedido" nesse caso confunde o operador: ele recarrega, vê o próprio
// pedido intocado, e a mensagem não bate com o que aconteceu.
const MENSAGEM_CONFLITO_MATERIAL_COMPARTILHADO =
  "Outro pedido usando o mesmo material foi processado ao mesmo tempo — tente novamente.";

// Sinaliza, de dentro da transação, que o status já mudou entre a leitura
// inicial e a escrita (duplo clique, duas abas, retry de rede) — usado só
// pra abortar com uma mensagem amigável. Não é um erro de banco de verdade.
class ErroPedidoJaAvancado extends Error {}

// Achado B3 — sinaliza, de dentro da transação, que a baixa OPCIONAL de
// refugo deixaria algum material negativo. Ao contrário da perda fixa (que
// valida `validarEstoqueSuficiente` ANTES da transação, agregando por
// material físico), a baixa de refugo valida linha a linha DENTRO da
// transação via updateMany condicional (`estoqueAtual: { gte: ... }`) — mais
// simples de justificar aqui porque é sempre no máximo uma dezena de linhas
// (a ficha técnica de um único pedido), nunca o volume que justificou a
// agregação pré-transação da perda fixa. Aborta a transação inteira (a
// própria transição de status é revertida junto) — o operador pode
// desmarcar "dar baixa de estoque" e tentar de novo só reportando o refugo.
class ErroEstoqueInsuficienteRefugo extends Error {}

// Compartilhado entre previsaoBaixaEstoque (producao/actions.ts, só leitura,
// pra montar a tela de confirmação) e a baixa de verdade abaixo — mantém os
// dois call-sites com exatamente o mesmo formato de dado, evitando que a
// tela de confirmação mostre algo diferente do que de fato será descontado.
export function buscarOrcamentoParaBaixa(orcamentoId: string) {
  return prisma.orcamento.findUnique({
    where: { id: orcamentoId },
    include: {
      itens: {
        include: {
          itemGrafica: {
            include: {
              fichaTecnica: {
                include: {
                  materiaPrima: { include: { itemCatalogo: true } },
                  variante: true,
                },
              },
            },
          },
          // Achado N5 da auditoria de código (2026-09-04) — papel escolhido
          // NESTE orçamento pro motor de clichê de etiqueta (M2), única fonte
          // pra identificar automaticamente qual linha da ficha técnica é o
          // substrato quando o item usa esse motor (ver
          // src/lib/baixa-estoque-substrato.ts). Ausente (null) em qualquer
          // item que não usa o motor de clichê — sem custo extra de query
          // pra quem não usa (é um 1:1 opcional, já resolvido pelo mesmo
          // include de item.itens que já existia).
          precificacaoEtiqueta: { select: { papelId: true } },
          // Acabamentos anexados ao item (ex: laminação) — mesma forma de
          // include que itemGrafica.fichaTecnica acima, só que agora pela
          // ficha técnica do SERVIÇO (ItemGrafica tipo SERVICO), não do
          // produto. Aditivo: um acabamento sem ficha técnica cadastrada
          // (o caso mais comum ainda) vem com `fichaTecnica: []` e não
          // participa de nenhuma baixa (ver fase-custo-real.md, PR-7).
          acabamentos: {
            include: {
              itemGrafica: {
                include: {
                  fichaTecnica: {
                    include: {
                      materiaPrima: { include: { itemCatalogo: true } },
                      variante: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

// 1 milhão numa única linha é um teto "irreal" de propósito — nenhuma perda
// de calibragem de verdade chega perto disso, então ele só existe pra pegar
// erro de digitação grosseiro (ex: um zero a mais) sem incomodar o uso normal.
const PERDA_MAXIMA = 1_000_000;

// Snapshot de custo no momento da baixa (fase "custo real", §1.1 do plano):
// lê o preço de compra vigente da matéria-prima (ou da variante, se
// varianteId estiver setado) e o congela na MovimentacaoEstoque — nunca
// recalculado depois, mesmo que o preço do cadastro mude. `null` quando o
// preço de compra não está cadastrado: a UI mostra "—", nunca R$0,00 (zero
// mentiria que o custo foi apurado como zero). VarianteMateriaPrima não tem
// `updatedAt` no schema, então precoReferenciaEm só é preenchido pro caminho
// sem variante.
function snapshotCustoFicha(
  ficha: {
    varianteId: string | null;
    materiaPrima: { precoCompra: Prisma.Decimal | null; updatedAt: Date };
    variante: { precoCompra: Prisma.Decimal } | null;
  },
  quantidade: number
): { custoUnitario: string | null; custoTotal: string | null; precoReferenciaEm: Date | null } {
  const precoCompra = ficha.varianteId ? (ficha.variante?.precoCompra ?? null) : ficha.materiaPrima.precoCompra;
  if (precoCompra === null) {
    return { custoUnitario: null, custoTotal: null, precoReferenciaEm: null };
  }
  const custoUnitarioDec = new D(precoCompra.toString());
  const custoTotalDec = custoUnitarioDec.times(quantidade);
  return {
    custoUnitario: custoUnitarioDec.toFixed(4),
    custoTotal: custoTotalDec.toFixed(2),
    precoReferenciaEm: ficha.varianteId ? null : ficha.materiaPrima.updatedAt,
  };
}

// Achado F4 da auditoria de abrangência (Parte 7, 2026-09-05) — snapshot de
// LOTE/VALIDADE no momento da baixa, mesmo espírito de snapshotCustoFicha
// acima (mas pra lote em vez de custo): copia da ENTRADA_COMPRA pra dentro
// da SAIDA_PRODUCAO, ligando lote→pedido "de graça", sem model novo.
//
// Só roda quando `ficha.materiaPrima.controlaLote` está ativo (opt-in) —
// pra 99% das matérias-primas que nunca ligaram isso, zero query extra.
//
// IMPORTANTE (documentado também no schema, campo MovimentacaoEstoque.lote):
// este sistema NÃO faz FEFO nem apropriação automática de lote (proposta
// explícita do achado F4 — "não fazer agora"). Quando há mais de um lote
// em estoque ao mesmo tempo pro mesmo item/variante, não há como saber com
// certeza qual foi fisicamente consumido nesta baixa. Por isso o snapshot
// aqui sempre copia o lote da ENTRADA_COMPRA MAIS RECENTE (com lote
// preenchido) — é rastro documentado ("provavelmente saiu deste lote"),
// não rastreabilidade FEFO de verdade. Uma gráfica que de fato precisa de
// FEFO (apropriação exata por lote com saldo restante por lote) precisa de
// um model novo — fora do escopo deste achado.
async function snapshotLoteFicha(
  tx: Prisma.TransactionClient,
  ficha: { varianteId: string | null; materiaPrimaId: string; materiaPrima: { controlaLote: boolean } }
): Promise<{ lote: string | null; validade: Date | null }> {
  if (!ficha.materiaPrima.controlaLote) {
    return { lote: null, validade: null };
  }
  const ultimaEntrada = await tx.movimentacaoEstoque.findFirst({
    where: {
      itemGraficaId: ficha.materiaPrimaId,
      varianteId: ficha.varianteId,
      tipo: "ENTRADA_COMPRA",
      lote: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { lote: true, validade: true },
  });
  return { lote: ultimaEntrada?.lote ?? null, validade: ultimaEntrada?.validade ?? null };
}

// Custo automático da baixa de produção (fase "custo real", §1.4/§3.2 do
// plano): cria um CustoPedido origem=CONSUMO_ESTOQUE atrelado 1:1 à
// MovimentacaoEstoque recém-criada — movimentacaoEstoqueId é @unique no
// schema, e é isso que garante idempotência (nunca duas vezes pra mesma
// movimentação, porque cada MovimentacaoEstoque nasce com id novo a cada
// chamada; um duplo clique nem chega até aqui, é barrado antes pelo CAS de
// status). Resolve a categoria em cascata (matéria-prima → padrão da
// gráfica → primeira categoria ativa, com cache pra não repetir a query de
// fallback a cada material do mesmo pedido) e nunca soma em cima de um
// custo manual já lançado na mesma categoria — só marca
// possivelDuplicidade=true pra UI avisar depois. Defensivo: se a gráfica
// não tiver NENHUMA categoria de custo (não deveria acontecer —
// garantirCategoriasCustoPadrao roda no bootstrap), loga e desiste sem
// lançar exceção — a baixa de estoque em si NUNCA pode falhar por causa
// disto.
async function criarCustoAutomaticoConsumo(
  tx: Prisma.TransactionClient,
  params: {
    graficaId: string;
    pedidoId: string;
    movimentacaoId: string;
    custoTotal: Prisma.Decimal | null;
    categoriaCustoIdMaterial: string | null;
    categoriaCustoConsumoPadraoId: string | null;
    categoriaFallbackCache: { valor: string | null | undefined };
  }
): Promise<void> {
  // Movimentação sem preço de custo cadastrado (precoCompra null na
  // matéria-prima/variante) não gera custo automático — nada a lançar, e
  // nada de inventar R$0,00 (zero mentiria que o custo foi apurado).
  if (params.custoTotal === null) return;

  let categoriaCustoId = params.categoriaCustoIdMaterial ?? params.categoriaCustoConsumoPadraoId;
  if (!categoriaCustoId) {
    if (params.categoriaFallbackCache.valor === undefined) {
      const categoria = await tx.categoriaCusto.findFirst({
        where: { graficaId: params.graficaId, ativa: true },
        orderBy: { ordem: "asc" },
        select: { id: true },
      });
      params.categoriaFallbackCache.valor = categoria?.id ?? null;
    }
    categoriaCustoId = params.categoriaFallbackCache.valor;
  }
  if (!categoriaCustoId) {
    console.error(
      `[custo-automatico] Gráfica ${params.graficaId} sem nenhuma CategoriaCusto ativa — CustoPedido automático da movimentação ${params.movimentacaoId} (pedido ${params.pedidoId}) não foi criado.`
    );
    return;
  }

  // §1.4: custo automático nunca sobrescreve/soma calado em cima de custo
  // humano — só marca possivelDuplicidade pra UI resolver.
  const existeManualMesmaCategoria = await tx.custoPedido.findFirst({
    where: { pedidoId: params.pedidoId, categoriaCustoId, origem: "MANUAL" },
    select: { id: true },
  });

  await tx.custoPedido.create({
    data: {
      graficaId: params.graficaId,
      pedidoId: params.pedidoId,
      categoriaCustoId,
      origem: "CONSUMO_ESTOQUE",
      movimentacaoEstoqueId: params.movimentacaoId,
      valor: params.custoTotal,
      valorCalculado: params.custoTotal,
      possivelDuplicidade: existeManualMesmaCategoria !== null,
    },
  });
}

// Achado B3 da auditoria de abrangência (Parte 2/Produção, 2026-09-07) —
// baixa de matéria-prima OPCIONAL (o operador decide, nunca imposta) quando
// um apontamento reporta quantidadeRefugo > 0. Reaproveita literalmente o
// MESMO motor da perda fixa de calibragem acima (snapshotCustoFicha,
// snapshotLoteFicha, criarCustoAutomaticoConsumo) — a diferença é só a
// origem do gatilho (apontamento manual do operador, não a transição
// automática CLICHE_FACA→PRODUCAO) e a quantidade (proporcional ao refugo
// reportado, ver calcularBaixaRefugoLinha, não um valor fixo cadastrado).
//
// Só a ficha técnica do PRODUTO entra aqui, não a de acabamentos anexados —
// decisão de escopo desta rodada (mesmo espírito de simplificação aceito em
// outras partes do sistema, ex: achado A10/Editorial): o substrato principal
// já cobre a maior parte do custo real de refazer peças refugadas, e
// estender pra acabamento seria duplicar quase todo este bloco de novo.
//
// Mesmo shape de item/ficha que buscarOrcamentoParaBaixa devolve — derivado
// do próprio tipo de retorno em vez de redeclarado à mão, pra nunca divergir
// da forma real da query (mesma técnica usada pelos loops de perda fixa
// acima, que também recebem exatamente `orcamentoComItens?.itens`).
type OrcamentoParaBaixa = NonNullable<Awaited<ReturnType<typeof buscarOrcamentoParaBaixa>>>;
type ItemParaBaixaRefugo = OrcamentoParaBaixa["itens"][number];

// Validação de estoque linha a linha, DENTRO da transação (não agregada
// antes dela como a perda fixa faz) — ver comentário de
// ErroEstoqueInsuficienteRefugo acima.
async function aplicarBaixaRefugo(
  tx: Prisma.TransactionClient,
  params: {
    graficaId: string;
    pedidoId: string;
    orcamentoId: string;
    quantidadeRefugo: number;
    motivoRefugo: MotivoRefugo | null;
    motivoRefugoOutro: string | null;
    itens: ItemParaBaixaRefugo[];
    custoAutomaticoConsumo: boolean;
    categoriaCustoConsumoPadraoId: string | null;
    categoriaFallbackCache: { valor: string | null | undefined };
  }
): Promise<void> {
  const gerarCustoPedido = params.custoAutomaticoConsumo && refugoGeraCustoAutomatico(params.motivoRefugo);
  const rotulo =
    params.motivoRefugo === "OUTRO" && params.motivoRefugoOutro
      ? params.motivoRefugoOutro
      : ROTULOS_MOTIVO_REFUGO[params.motivoRefugo ?? "OUTRO"];

  for (const item of params.itens) {
    for (const ficha of item.itemGrafica.fichaTecnica) {
      const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
      if (estoqueAtual === null) continue; // sem controle de estoque

      const quantidadeConsumidaTotal = calcularQuantidadeConsumidaFichaProduto(item, ficha);
      const quantidadeBaixa = calcularBaixaRefugoLinha(
        { quantidadeConsumidaTotal, quantidadeItemPedido: item.quantidade },
        params.quantidadeRefugo
      );
      if (quantidadeBaixa <= 0) continue;

      // updateMany condicional (não update por id) — CAS por linha: só
      // decrementa se o saldo ATUAL (já refletindo qualquer decremento
      // anterior nesta MESMA transação, ex: consumo normal + perda fixa
      // acima, ou outra linha deste próprio loop no mesmo material) ainda
      // comporta a baixa. count===0 aborta a transação inteira.
      if (ficha.varianteId) {
        const resultado = await tx.varianteMateriaPrima.updateMany({
          where: { id: ficha.varianteId, estoqueAtual: { gte: quantidadeBaixa } },
          data: { estoqueAtual: { decrement: quantidadeBaixa } },
        });
        if (resultado.count === 0) throw new ErroEstoqueInsuficienteRefugo();
      } else {
        const resultado = await tx.itemGrafica.updateMany({
          where: { id: ficha.materiaPrimaId, estoqueAtual: { gte: quantidadeBaixa } },
          data: { estoqueAtual: { decrement: quantidadeBaixa } },
        });
        if (resultado.count === 0) throw new ErroEstoqueInsuficienteRefugo();
      }

      const movimentacaoRefugo = await tx.movimentacaoEstoque.create({
        data: {
          itemGraficaId: ficha.materiaPrimaId,
          varianteId: ficha.varianteId,
          pedidoId: params.pedidoId,
          tipo: "SAIDA_PRODUCAO",
          quantidade: quantidadeBaixa,
          motivo: `Refugo de produção (${rotulo}) — pedido ${params.pedidoId} (orçamento ${params.orcamentoId})`,
          ...snapshotCustoFicha(ficha, quantidadeBaixa),
          ...(await snapshotLoteFicha(tx, ficha)),
        },
      });
      if (gerarCustoPedido) {
        await criarCustoAutomaticoConsumo(tx, {
          graficaId: params.graficaId,
          pedidoId: params.pedidoId,
          movimentacaoId: movimentacaoRefugo.id,
          custoTotal: movimentacaoRefugo.custoTotal,
          categoriaCustoIdMaterial: ficha.materiaPrima.categoriaCustoId,
          categoriaCustoConsumoPadraoId: params.categoriaCustoConsumoPadraoId,
          categoriaFallbackCache: params.categoriaFallbackCache,
        });
      }
    }
  }
}

const linhaPerdaSchema = z.object({
  chave: z.string().min(1),
  perdaAplicada: z.coerce
    .number()
    .finite("Valor de perda inválido.")
    .min(0, "Perda aplicada não pode ser negativa.")
    .max(PERDA_MAXIMA, `Perda aplicada não pode passar de ${PERDA_MAXIMA.toLocaleString("pt-BR")}.`),
});

// contexto tem default (canal APP, sem operador/máquina) só pra não quebrar
// os call-sites de teste já existentes que chamavam esta função com 2
// argumentos antes do achado B1/B2 (histórico de ApontamentoEtapa) — os 3
// canais de verdade (avancarPedido/confirmarEstagioPublico/avancarStatusQr)
// sempre passam o contexto explicitamente.
const CONTEXTO_PADRAO: ContextoOrigemAvanco = { origemConfirmacao: "APP", operadorId: null };

export async function avancarStatusPedido(
  pedido: PedidoParaAvanco,
  perdasJsonBruto: FormDataEntryValue | null,
  contexto: ContextoOrigemAvanco = CONTEXTO_PADRAO,
  // Achado B3 — refugo reportado pelo operador SOBRE a etapa que o pedido
  // está SAINDO (statusAnterior), já validado por parseRefugoFormData
  // (src/app/producao/actions.ts). `undefined`/`null` (nenhum dos 3
  // canais de teste antigos passa isso, nem os canais LINK_PUBLICO/
  // QR_ETIQUETA que não coletam refugo — mesma decisão de escopo de B2 pra
  // máquina) é tratado como "nada a reportar", zero mudança de
  // comportamento.
  refugo?: RefugoInput | null
): Promise<AvancarStatusResult> {
  // Gate opt-in: só bloqueia se ESTA gráfica enviou uma arte pra este
  // pedido (arteUrl preenchido) — pedidos sem arte enviada avançam
  // normalmente, sem exigir nada novo. Uma vez enviada, exige aprovação do
  // cliente (ver /a/[token]) antes de sair de ARTE.
  if (pedido.status === "ARTE" && pedido.arteUrl && !pedido.arteAprovadaEm) {
    return {
      ok: false,
      mensagem: "A arte precisa ser aprovada pelo cliente antes de iniciar a impressão.",
    };
  }

  // Achado F5 da auditoria de abrangência (Parte 7) — gate GEMEO do de cima,
  // mas por ArteItem (arte por item de orçamento, ver model ArteItem no
  // schema). Mesmo princípio opt-in: "toda ArteItem deste pedido está
  // aprovada OU nenhuma ArteItem existe pra este pedido" — uma gráfica que
  // nunca usa arte por item nunca tem nenhuma linha com este pedidoId, então
  // count() sempre dá 0 e este bloco nunca bloqueia nada (zero mudança de
  // comportamento pra quem só usa o arteUrl de cabeçalho acima). Distinto do
  // gate de cabeçalho: aqui não importa se o PEDIDO tem arteUrl preenchido
  // ou não, só se existe alguma ArteItem pendente vinculada a ele.
  if (pedido.status === "ARTE") {
    const arteItensPendentes = await prisma.arteItem.count({
      where: { pedidoId: pedido.id, aprovadaEm: null },
    });
    if (arteItensPendentes > 0) {
      return {
        ok: false,
        mensagem:
          arteItensPendentes === 1
            ? "A arte de 1 item ainda não foi aprovada pelo cliente."
            : `A arte de ${arteItensPendentes} itens ainda não foi aprovada pelo cliente.`,
      };
    }
  }

  // Achado A1 (Fase 1) — sequência resolvida por gráfica (liga/desliga e
  // reordena etapa, ver EtapaGrafica), não mais o array literal fixo. Uma
  // gráfica sem nenhuma linha configurada recebe de volta exatamente
  // SEQUENCIA_STATUS_PEDIDO (bootstrap lazy, ver resolverEtapasGrafica) —
  // regressão zero pra quem nunca abriu a tela nova.
  const etapas = await resolverEtapasGrafica(pedido.graficaId);

  const indiceAtual = etapas.sequencia.indexOf(pedido.status);
  if (indiceAtual === -1) {
    // Defensivo: hoje só alcançável se a gráfica desativou a etapa em que
    // este pedido está PARADO (não a etapa de destino) depois que ele já
    // chegou lá — sem essa checagem, [-1+1] resolveria silenciosamente pro
    // índice 0 da sequência ativa, regredindo o pedido em vez de dar erro.
    return {
      ok: false,
      mensagem: "A etapa atual deste pedido está desativada nas configurações — reative-a em Configurações > Etapas de produção pra poder avançar.",
    };
  }
  if (indiceAtual === etapas.sequencia.length - 1) {
    return { ok: false, mensagem: "Este pedido já está no status final." };
  }

  const proximoStatus = etapas.sequencia[indiceAtual + 1];
  const statusAnterior = pedido.status;

  // Achado B3 — normaliza o refugo recebido: só há baixa a aplicar quando o
  // operador de fato reportou quantidadeRefugo > 0 (quantidadeRefugo=0 ou
  // não informado nunca dispara nada, mesmo que gerarBaixaEstoque venha
  // marcado por engano). O snapshot gravado no ApontamentoEtapa fechado
  // (refugoParaFechamento) é mais permissivo: grava quantidadeBoa mesmo sem
  // refugo nenhum, é só "o que o operador reportou produzir nesta etapa".
  const refugoParaAplicar = refugo && refugo.quantidadeRefugo && refugo.quantidadeRefugo > 0 ? refugo : null;
  const refugoParaFechamento: RefugoParaFechamento | undefined = refugo
    ? {
        quantidadeBoa: refugo.quantidadeBoa,
        quantidadeRefugo: refugo.quantidadeRefugo,
        motivoRefugo: refugo.motivoRefugo,
        motivoRefugoOutro: refugo.motivoRefugoOutro,
      }
    : undefined;

  // Buscado uma única vez e reaproveitado pros eventos estoque_critico e
  // pedido_status_mudou abaixo.
  const automacao = await buscarAutomacaoGrafica(pedido.graficaId);

  try {
    // Baixa automática de estoque: só na ENTRADA em produção física — ou
    // seja, só quando o PRÓXIMO status é PRODUCAO, não importa de qual
    // etapa o pedido está saindo. Antes do achado A1 isso era literalmente
    // `pedido.status === "CLICHE_FACA"`, mas CLICHE_FACA pode estar
    // desativada pra esta gráfica (ver EtapaGrafica) — quando está, a
    // "última etapa ativa antes de PRODUCAO" é outra (ex: ARTE numa
    // gráfica só-digital), e é dela que a transição de fato sai. Checar só
    // `proximoStatus === "PRODUCAO"` cobre os dois casos sem duplicar nem
    // pular a baixa: `proximoStatus` já vem de `etapas.sequencia[indiceAtual
    // + 1]` acima, então só pode valer "PRODUCAO" quando `pedido.status` for
    // exatamente a etapa ativa imediatamente anterior a ela — PRODUCAO
    // nunca pode estar desativada (ver ETAPAS_SEMPRE_ATIVAS em
    // src/lib/etapa-grafica.ts), então esta condição sempre dispara
    // exatamente uma vez por pedido, não importa a configuração da gráfica.
    // Sem mecanismo de estorno automático aqui — ver cancelarPedido em
    // producao/actions.ts, que cobre isso.
    if (proximoStatus === "PRODUCAO") {
      // Leitura só-consulta (ficha técnica não muda por causa de uma corrida
      // desta função) — fica FORA da transação de propósito, pra manter a
      // transação curta e reduzir chance de conflito de serialização. O
      // mesmo vale pra ParametrosGrafica: os dois flags da fase "custo
      // real" (custoAutomaticoConsumo/categoriaCustoConsumoPadraoId) não
      // mudam por causa desta transição.
      const [orcamentoComItens, parametrosGrafica] = await Promise.all([
        buscarOrcamentoParaBaixa(pedido.orcamentoId),
        prisma.parametrosGrafica.findUnique({ where: { graficaId: pedido.graficaId } }),
      ]);
      // Sem linha em ParametrosGrafica ainda (gráfica nunca abriu
      // Configurações): trata como default do schema (true) — nunca como
      // "desligado por omissão".
      const custoAutomaticoConsumo = parametrosGrafica?.custoAutomaticoConsumo ?? true;
      const categoriaCustoConsumoPadraoId = parametrosGrafica?.categoriaCustoConsumoPadraoId ?? null;
      // Independente de custoAutomaticoConsumo acima — esse decide se HÁ
      // lançamento automático de custo; este decide se a PERDA especificamente
      // entra nesse lançamento (a baixa de estoque da perda acontece sempre,
      // de qualquer forma — ver os 2 usos abaixo, achado A1-Parte6 da
      // auditoria de abrangência, 2026-08-24).
      const perdaEhCustoDoPedido = parametrosGrafica?.perdaEhCustoDoPedido ?? true;
      // Cache do fallback "primeira categoria ativa da gráfica" — compartilhado
      // entre todas as chamadas de criarCustoAutomaticoConsumo desta transição,
      // pra não repetir a mesma query por material quando nem o material nem a
      // gráfica têm categoria configurada.
      const categoriaFallbackCache: { valor: string | null | undefined } = { valor: undefined };

      // Mesma granularidade (item do orçamento × item da ficha técnica) que
      // previsaoBaixaEstoque mostra na tela de confirmação — precisa bater
      // exatamente pra validar que a confirmação enviada cobre tudo que vai
      // ser descontado.
      const itensParaBaixaProduto = (orcamentoComItens?.itens ?? []).flatMap((item) =>
        item.itemGrafica.fichaTecnica
          .filter(
            (ficha) =>
              (ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual) !== null
          )
          .map((ficha) => {
            const perdaPadrao = ficha.variante
              ? ficha.variante.perdaFixaPadrao
              : ficha.materiaPrima.perdaFixaPadrao;
            const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
            return {
              chave: montarChavePerda(item.id, ficha.id),
              // Achado N5 da auditoria de código (2026-09-04) — quando este
              // item tem breakdown de motor avançado (OFFSET/M2/FLEXOGRAFIA)
              // e esta linha é o substrato identificado, usa o consumo FÍSICO
              // real (folhas/área/metragem) em vez do linear de sempre — ver
              // src/lib/baixa-estoque-substrato.ts. Precisa bater EXATAMENTE
              // com o mesmo cálculo dentro da transação abaixo (mesma função
              // compartilhada), senão a validação de estoque/perda aqui usaria
              // um número diferente do que é de fato descontado.
              quantidadeConsumida: calcularQuantidadeConsumidaFichaProduto(item, ficha),
              perdaPadrao: perdaPadrao !== null ? Number(perdaPadrao) : 0,
              estoqueAtual: Number(estoqueAtual),
              materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
              // Identidade física do material (ver chaveFisicaMaterial em
              // perda-fixa-producao.ts) — necessária pra agregar as linhas
              // ANTES de validar quando dois produtos deste orçamento usam o
              // mesmo material.
              materiaPrimaId: ficha.materiaPrimaId,
              varianteId: ficha.varianteId,
            };
          })
      );

      // Mesma lógica acima, mas pela ficha técnica dos SERVIÇOS anexados
      // como acabamento (ex: laminação consumindo BOPP) — a chave usa o id
      // do OrcamentoItemAcabamento (não do OrcamentoItem "pai") porque um
      // mesmo item de orçamento pode ter mais de um acabamento, e o
      // multiplicador é `acabamento.qtdBase` (o snapshot da base de cobrança
      // do acabamento, ex: folhas impressas que passaram pela laminação),
      // não `item.quantidade`. Aditivo: acabamento sem ficha técnica
      // cadastrada gera `[]` e não entra aqui.
      const itensParaBaixaAcabamento = (orcamentoComItens?.itens ?? []).flatMap((item) =>
        item.acabamentos.flatMap((acabamento) =>
          acabamento.itemGrafica.fichaTecnica
            .filter(
              (ficha) =>
                (ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual) !== null
            )
            .map((ficha) => {
              const perdaPadrao = ficha.variante
                ? ficha.variante.perdaFixaPadrao
                : ficha.materiaPrima.perdaFixaPadrao;
              const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
              return {
                chave: montarChavePerda(acabamento.id, ficha.id),
                quantidadeConsumida: Number(ficha.quantidadePorUnidade) * Number(acabamento.qtdBase),
                perdaPadrao: perdaPadrao !== null ? Number(perdaPadrao) : 0,
                estoqueAtual: Number(estoqueAtual),
                materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
                materiaPrimaId: ficha.materiaPrimaId,
                varianteId: ficha.varianteId,
              };
            })
        )
      );

      const itensParaBaixa = [...itensParaBaixaProduto, ...itensParaBaixaAcabamento];

      // Teto de tamanho: não é o pedido que dita quantas linhas cabem aqui (ver
      // itensParaBaixa acima), é só uma trava contra um POST forjado com
      // milhares de chaves inventadas — extras já eram ignoradas, mas custavam
      // parse/validação de graça.
      const perdasParsed = parseJsonArray(perdasJsonBruto, linhaPerdaSchema, { max: 500 });
      if (!perdasParsed.ok) {
        return { ok: false, mensagem: perdasParsed.mensagem };
      }
      // Decisão de negócio: se a confirmação não cobrir todo mundo, bloqueia a
      // transição inteira antes de mexer no banco — nunca aplica um padrão
      // silenciosamente nem processa parcialmente (ver perda-fixa-producao.ts).
      const resolucaoPerdas = resolverPerdasConfirmadas(itensParaBaixa, perdasParsed.data);
      if (!resolucaoPerdas.ok) {
        return { ok: false, mensagem: resolucaoPerdas.mensagem };
      }
      const perdasPorChave = resolucaoPerdas.porChave;

      // Confere ANTES da transação que consumo + perda não deixa nenhum
      // material negativo — pega tanto um valor de perda digitado errado
      // quanto uma ficha técnica pedindo mais do que existe.
      const validacaoEstoque = validarEstoqueSuficiente(itensParaBaixa, perdasPorChave);
      if (!validacaoEstoque.ok) {
        return { ok: false, mensagem: validacaoEstoque.mensagem };
      }

      // Coletado durante o loop e disparado só DEPOIS que a transação confirmar
      // — evita mandar aviso de estoque crítico pra uma baixa que pode não ter
      // sido de fato persistida.
      const eventosEstoqueCritico: { itemNome: string; estoqueAtual: number; estoqueMinimo: number }[] = [];

      await prisma.$transaction(
        async (tx) => {
          // updateMany com o status ANTERIOR no where (não um update simples
          // por id) é o que impede duplo clique/duas abas/retry de rede
          // descontarem o estoque duas vezes: se outra requisição concorrente
          // já mudou o status entre a leitura lá em cima e aqui, count vem 0
          // e abortamos — em vez de decrementar de novo por cima de um pedido
          // que já não está mais em CLICHE_FACA.
          const resultado = await tx.pedido.updateMany({
            where: { id: pedido.id, status: statusAnterior },
            data: { status: proximoStatus },
          });
          if (resultado.count === 0) {
            throw new ErroPedidoJaAvancado();
          }

          // Achado B1/B2 (histórico de etapa + máquina): fecha o apontamento
          // da etapa que o pedido está SAINDO (CLICHE_FACA) e abre o da que
          // está ENTRANDO (PRODUCAO), dentro da MESMA transação do CAS acima
          // — nunca depois, senão uma corrida entre esta baixa de estoque e
          // outra transição do mesmo pedido poderia confirmar o status sem
          // o histórico correspondente.
          await fecharEAbrirApontamento(tx, {
            graficaId: pedido.graficaId,
            pedidoId: pedido.id,
            proximoStatus,
            refugo: refugoParaFechamento,
            ...contexto,
          });

          // Achado B3 — baixa OPCIONAL de refugo reportado pelo operador
          // sobre a etapa que o pedido está SAINDO. Reaproveita
          // orcamentoComItens/custoAutomaticoConsumo/
          // categoriaCustoConsumoPadraoId/categoriaFallbackCache já lidos
          // acima pra perda fixa — nenhuma query extra só por causa disto.
          if (refugoParaAplicar?.gerarBaixaEstoque) {
            await aplicarBaixaRefugo(tx, {
              graficaId: pedido.graficaId,
              pedidoId: pedido.id,
              orcamentoId: pedido.orcamentoId,
              quantidadeRefugo: refugoParaAplicar.quantidadeRefugo!,
              motivoRefugo: refugoParaAplicar.motivoRefugo,
              motivoRefugoOutro: refugoParaAplicar.motivoRefugoOutro,
              itens: orcamentoComItens?.itens ?? [],
              custoAutomaticoConsumo,
              categoriaCustoConsumoPadraoId,
              categoriaFallbackCache,
            });
          }

          // Acumula o decremento TOTAL por material FÍSICO (varianteId ??
          // materiaPrimaId, ver chaveFisicaMaterial) enquanto o loop roda —
          // quando dois produtos deste orçamento consomem o mesmo material,
          // cruzouLimiteMinimo só pode ser avaliado depois de somar as duas
          // linhas; avaliando linha a linha ele podia disparar (ou deixar de
          // disparar) o alerta usando o estoqueDepois de uma baixa isolada,
          // que não reflete onde o estoque de fato ficou ao final da
          // transição inteira.
          const acumuladoPorMaterial = new Map<
            string,
            { estoqueAtual: number; estoqueMinimo: number | null; materiaPrimaNome: string; totalDecremento: number }
          >();

          for (const item of orcamentoComItens?.itens ?? []) {
            for (const ficha of item.itemGrafica.fichaTecnica) {
              // Com variante (ex: espessura de chapa), o saldo de estoque é o da
              // variante, não o do ItemGrafica "pai" — cada variante é fisicamente
              // um estoque separado. Sem variante, comportamento de sempre.
              const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
              if (estoqueAtual === null) continue; // sem controle de estoque
              // Achado N5 — mesma função de itensParaBaixaProduto acima
              // (leitura pré-transação), garante que o número validado antes
              // é EXATAMENTE o número decrementado aqui.
              const quantidadeConsumida = calcularQuantidadeConsumidaFichaProduto(item, ficha);
              // Validado antes da transação (resolverPerdasConfirmadas) — toda
              // chave esperada aqui já tem confirmação, o "!" é seguro.
              const chave = montarChavePerda(item.id, ficha.id);
              const perdaAplicada = perdasPorChave.get(chave)!;

              if (ficha.varianteId) {
                await tx.varianteMateriaPrima.update({
                  where: { id: ficha.varianteId },
                  data: { estoqueAtual: { decrement: quantidadeConsumida } },
                });
              } else {
                await tx.itemGrafica.update({
                  where: { id: ficha.materiaPrimaId },
                  data: { estoqueAtual: { decrement: quantidadeConsumida } },
                });
              }
              const movimentacaoConsumo = await tx.movimentacaoEstoque.create({
                data: {
                  itemGraficaId: ficha.materiaPrimaId,
                  varianteId: ficha.varianteId,
                  pedidoId: pedido.id,
                  tipo: "SAIDA_PRODUCAO",
                  quantidade: quantidadeConsumida,
                  motivo: `Produção do pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
                  ...snapshotCustoFicha(ficha, quantidadeConsumida),
                  ...(await snapshotLoteFicha(tx, ficha)),
                },
              });
              if (custoAutomaticoConsumo) {
                await criarCustoAutomaticoConsumo(tx, {
                  graficaId: pedido.graficaId,
                  pedidoId: pedido.id,
                  movimentacaoId: movimentacaoConsumo.id,
                  custoTotal: movimentacaoConsumo.custoTotal,
                  categoriaCustoIdMaterial: ficha.materiaPrima.categoriaCustoId,
                  categoriaCustoConsumoPadraoId,
                  categoriaFallbackCache,
                });
              }

              // Movimentação SEPARADA da baixa por ficha técnica acima (não soma
              // no mesmo registro) — assim cancelarPedido, que já reverte TODA
              // saída encontrada pelo pedidoId sem filtrar por motivo, estorna as
              // duas automaticamente sem precisar de nenhuma mudança lá.
              if (perdaAplicada > 0) {
                if (ficha.varianteId) {
                  await tx.varianteMateriaPrima.update({
                    where: { id: ficha.varianteId },
                    data: { estoqueAtual: { decrement: perdaAplicada } },
                  });
                } else {
                  await tx.itemGrafica.update({
                    where: { id: ficha.materiaPrimaId },
                    data: { estoqueAtual: { decrement: perdaAplicada } },
                  });
                }
                const movimentacaoPerda = await tx.movimentacaoEstoque.create({
                  data: {
                    itemGraficaId: ficha.materiaPrimaId,
                    varianteId: ficha.varianteId,
                    pedidoId: pedido.id,
                    tipo: "SAIDA_PRODUCAO",
                    quantidade: perdaAplicada,
                    motivo: `Perda fixa de calibragem — pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
                    ...snapshotCustoFicha(ficha, perdaAplicada),
                    ...(await snapshotLoteFicha(tx, ficha)),
                  },
                });
                if (custoAutomaticoConsumo && perdaEhCustoDoPedido) {
                  await criarCustoAutomaticoConsumo(tx, {
                    graficaId: pedido.graficaId,
                    pedidoId: pedido.id,
                    movimentacaoId: movimentacaoPerda.id,
                    custoTotal: movimentacaoPerda.custoTotal,
                    categoriaCustoIdMaterial: ficha.materiaPrima.categoriaCustoId,
                    categoriaCustoConsumoPadraoId,
                    categoriaFallbackCache,
                  });
                }
              }

              const estoqueMinimo = ficha.variante ? ficha.variante.estoqueMinimo : ficha.materiaPrima.estoqueMinimo;
              const chaveFisica = chaveFisicaMaterial(ficha);
              const decrementoLinha = quantidadeConsumida + perdaAplicada;
              const existente = acumuladoPorMaterial.get(chaveFisica);
              if (existente) {
                existente.totalDecremento += decrementoLinha;
              } else {
                acumuladoPorMaterial.set(chaveFisica, {
                  estoqueAtual: Number(estoqueAtual),
                  estoqueMinimo: estoqueMinimo === null ? null : Number(estoqueMinimo),
                  materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
                  totalDecremento: decrementoLinha,
                });
              }
            }

            // Mesma baixa acima, agora pela ficha técnica dos SERVIÇOS
            // anexados como acabamento (ex: laminação consumindo BOPP) — ver
            // comentário no schema de FichaTecnicaItem e fase-custo-real.md
            // §item 2. Único ponto de diferença real: o multiplicador é
            // `acabamento.qtdBase` (snapshot da base de cobrança do
            // acabamento — ex: folhas impressas que passaram pela
            // laminação), não `item.quantidade`. Aditivo: acabamento sem
            // ficha técnica cadastrada tem `fichaTecnica: []` e este loop
            // não faz nada pra ele — nenhuma baixa, nenhum CustoPedido,
            // comportamento idêntico ao de hoje.
            for (const acabamento of item.acabamentos) {
              for (const ficha of acabamento.itemGrafica.fichaTecnica) {
                const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
                if (estoqueAtual === null) continue; // sem controle de estoque

                const quantidadeConsumida = Number(ficha.quantidadePorUnidade) * Number(acabamento.qtdBase);
                // Validado antes da transação (resolverPerdasConfirmadas) —
                // toda chave esperada aqui já tem confirmação, o "!" é
                // seguro (mesmo raciocínio do loop de produto acima).
                const chave = montarChavePerda(acabamento.id, ficha.id);
                const perdaAplicada = perdasPorChave.get(chave)!;

                if (ficha.varianteId) {
                  await tx.varianteMateriaPrima.update({
                    where: { id: ficha.varianteId },
                    data: { estoqueAtual: { decrement: quantidadeConsumida } },
                  });
                } else {
                  await tx.itemGrafica.update({
                    where: { id: ficha.materiaPrimaId },
                    data: { estoqueAtual: { decrement: quantidadeConsumida } },
                  });
                }
                const movimentacaoConsumo = await tx.movimentacaoEstoque.create({
                  data: {
                    itemGraficaId: ficha.materiaPrimaId,
                    varianteId: ficha.varianteId,
                    pedidoId: pedido.id,
                    tipo: "SAIDA_PRODUCAO",
                    motivo: `Acabamento do pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
                    quantidade: quantidadeConsumida,
                    ...snapshotCustoFicha(ficha, quantidadeConsumida),
                    ...(await snapshotLoteFicha(tx, ficha)),
                  },
                });
                if (custoAutomaticoConsumo) {
                  await criarCustoAutomaticoConsumo(tx, {
                    graficaId: pedido.graficaId,
                    pedidoId: pedido.id,
                    movimentacaoId: movimentacaoConsumo.id,
                    custoTotal: movimentacaoConsumo.custoTotal,
                    categoriaCustoIdMaterial: ficha.materiaPrima.categoriaCustoId,
                    categoriaCustoConsumoPadraoId,
                    categoriaFallbackCache,
                  });
                }

                // Movimentação SEPARADA da baixa por ficha técnica acima —
                // mesmo motivo do loop de produto: cancelarPedido reverte
                // TODA saída pelo pedidoId sem filtrar por motivo.
                if (perdaAplicada > 0) {
                  if (ficha.varianteId) {
                    await tx.varianteMateriaPrima.update({
                      where: { id: ficha.varianteId },
                      data: { estoqueAtual: { decrement: perdaAplicada } },
                    });
                  } else {
                    await tx.itemGrafica.update({
                      where: { id: ficha.materiaPrimaId },
                      data: { estoqueAtual: { decrement: perdaAplicada } },
                    });
                  }
                  const movimentacaoPerda = await tx.movimentacaoEstoque.create({
                    data: {
                      itemGraficaId: ficha.materiaPrimaId,
                      varianteId: ficha.varianteId,
                      pedidoId: pedido.id,
                      tipo: "SAIDA_PRODUCAO",
                      quantidade: perdaAplicada,
                      motivo: `Perda fixa de calibragem (acabamento) — pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
                      ...snapshotCustoFicha(ficha, perdaAplicada),
                      ...(await snapshotLoteFicha(tx, ficha)),
                    },
                  });
                  if (custoAutomaticoConsumo && perdaEhCustoDoPedido) {
                    await criarCustoAutomaticoConsumo(tx, {
                      graficaId: pedido.graficaId,
                      pedidoId: pedido.id,
                      movimentacaoId: movimentacaoPerda.id,
                      custoTotal: movimentacaoPerda.custoTotal,
                      categoriaCustoIdMaterial: ficha.materiaPrima.categoriaCustoId,
                      categoriaCustoConsumoPadraoId,
                      categoriaFallbackCache,
                    });
                  }
                }

                // Mesmo acumulador FÍSICO do loop de produto acima — um
                // material usado tanto na ficha técnica do produto quanto na
                // do acabamento (ex: os dois na mesma matéria-prima) precisa
                // somar no mesmo balde antes de avaliar cruzouLimiteMinimo.
                const estoqueMinimo = ficha.variante ? ficha.variante.estoqueMinimo : ficha.materiaPrima.estoqueMinimo;
                const chaveFisica = chaveFisicaMaterial(ficha);
                const decrementoLinha = quantidadeConsumida + perdaAplicada;
                const existente = acumuladoPorMaterial.get(chaveFisica);
                if (existente) {
                  existente.totalDecremento += decrementoLinha;
                } else {
                  acumuladoPorMaterial.set(chaveFisica, {
                    estoqueAtual: Number(estoqueAtual),
                    estoqueMinimo: estoqueMinimo === null ? null : Number(estoqueMinimo),
                    materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
                    totalDecremento: decrementoLinha,
                  });
                }
              }
            }
          }

          // Avaliado uma única vez por material FÍSICO, depois de somar todas
          // as linhas que caem nele — não mais dentro do loop acima.
          for (const acumulado of acumuladoPorMaterial.values()) {
            const estoqueDepois = calcularEstoqueDepois(acumulado.estoqueAtual, acumulado.totalDecremento, 0);
            if (cruzouLimiteMinimo(acumulado.estoqueAtual, estoqueDepois, acumulado.estoqueMinimo)) {
              eventosEstoqueCritico.push({
                itemNome: acumulado.materiaPrimaNome,
                estoqueAtual: estoqueDepois,
                estoqueMinimo: acumulado.estoqueMinimo ?? 0,
              });
            }
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      if (automacao.webhookUrl && automacao.notificarEstoqueCritico) {
        const webhookUrl = automacao.webhookUrl;
        for (const evento of eventosEstoqueCritico) {
          // after() em vez de void: garante que a instância serverless
          // continua viva até o webhook terminar, mesmo depois da resposta
          // já ter sido enviada ao cliente.
          after(() =>
            dispararEventoAutomacao(webhookUrl, {
              tipo: "estoque_critico",
              graficaNome: pedido.orcamento.grafica.nome,
              ...evento,
            })
          );
        }
      }
    } else {
      // Mesmo guard de "só avança se o status ainda for o que a gente leu"
      // — aqui não é cumulativo como o desconto de estoque acima, mas sem
      // isso um duplo clique simplesmente re-confirmaria sucesso silencioso
      // numa transição que a outra requisição já tinha feito. Envolvido numa
      // transação (achado B1/B2) só pra garantir que o CAS e o abrir/fechar
      // de ApontamentoEtapa sejam atômicos — nível de isolamento padrão
      // basta aqui, não há leitura prévia de estoque compartilhado como no
      // branch acima que justificasse Serializable.
      //
      // Achado B3 — este é o branch que de fato cobre a maioria das
      // transições que reportam refugo (o pedido já ENTROU em produção antes
      // — o branch de cima só cobre a transição de ENTRADA). Leitura
      // condicional, FORA da transação (mesmo motivo do branch acima: mantém
      // a transação curta) — só paga a query quando o operador de fato pediu
      // baixa de estoque; a maioria das transições (sem refugo, ou refugo
      // sem baixa) não paga nada extra.
      let orcamentoParaRefugo: Awaited<ReturnType<typeof buscarOrcamentoParaBaixa>> = null;
      let custoAutomaticoConsumoRefugo = true;
      let categoriaCustoConsumoPadraoIdRefugo: string | null = null;
      if (refugoParaAplicar?.gerarBaixaEstoque) {
        const [orcamento, parametrosGrafica] = await Promise.all([
          buscarOrcamentoParaBaixa(pedido.orcamentoId),
          prisma.parametrosGrafica.findUnique({ where: { graficaId: pedido.graficaId } }),
        ]);
        orcamentoParaRefugo = orcamento;
        custoAutomaticoConsumoRefugo = parametrosGrafica?.custoAutomaticoConsumo ?? true;
        categoriaCustoConsumoPadraoIdRefugo = parametrosGrafica?.categoriaCustoConsumoPadraoId ?? null;
      }
      const categoriaFallbackCacheRefugo: { valor: string | null | undefined } = { valor: undefined };

      await prisma.$transaction(async (tx) => {
        const resultado = await tx.pedido.updateMany({
          where: { id: pedido.id, status: statusAnterior },
          data: { status: proximoStatus },
        });
        if (resultado.count === 0) {
          throw new ErroPedidoJaAvancado();
        }
        await fecharEAbrirApontamento(tx, {
          graficaId: pedido.graficaId,
          pedidoId: pedido.id,
          proximoStatus,
          refugo: refugoParaFechamento,
          ...contexto,
        });

        if (refugoParaAplicar?.gerarBaixaEstoque) {
          await aplicarBaixaRefugo(tx, {
            graficaId: pedido.graficaId,
            pedidoId: pedido.id,
            orcamentoId: pedido.orcamentoId,
            quantidadeRefugo: refugoParaAplicar.quantidadeRefugo!,
            motivoRefugo: refugoParaAplicar.motivoRefugo,
            motivoRefugoOutro: refugoParaAplicar.motivoRefugoOutro,
            itens: orcamentoParaRefugo?.itens ?? [],
            custoAutomaticoConsumo: custoAutomaticoConsumoRefugo,
            categoriaCustoConsumoPadraoId: categoriaCustoConsumoPadraoIdRefugo,
            categoriaFallbackCache: categoriaFallbackCacheRefugo,
          });
        }

        // Achado R1 da auditoria de abrangência (Parte 7, 2026-09-03) —
        // gatilho ENTREGA: gera as ContaReceber da condição de pagamento
        // vinculada ao orçamento, se ela usar essa âncora (ver
        // src/lib/condicao-pagamento.ts). Dentro da MESMA transação do CAS
        // acima — o CAS só passa uma vez por pedido (ENTREGUE é terminal em
        // SEQUENCIA_STATUS_PEDIDO), o que já garante idempotência aqui.
        if (proximoStatus === "ENTREGUE") {
          await gerarContasReceberDaEntrega(tx, {
            graficaId: pedido.graficaId,
            orcamentoId: pedido.orcamentoId,
            clienteId: pedido.orcamento.clienteId,
            condicaoPagamentoId: pedido.orcamento.condicaoPagamentoId,
            total: Number(pedido.orcamento.total),
            entregueEm: new Date(),
          });
        }
      });
    }
  } catch (erro) {
    if (erro instanceof ErroPedidoJaAvancado) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    if (erro instanceof ErroEstoqueInsuficienteRefugo) {
      return {
        ok: false,
        mensagem:
          'Estoque insuficiente para dar baixa do refugo reportado. Desmarque "dar baixa de estoque" pra só registrar o refugo, ou confira a quantidade.',
      };
    }
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_MATERIAL_COMPARTILHADO };
    }
    throw erro;
  }

  if (automacao.webhookUrl && automacao.notificarStatusMudou) {
    // after() em vez de void: garante que a instância serverless continua
    // viva até o webhook terminar, mesmo depois da resposta já ter sido
    // enviada ao cliente.
    const webhookUrl = automacao.webhookUrl;
    after(() =>
      dispararEventoAutomacao(webhookUrl, {
        tipo: "pedido_status_mudou",
        graficaNome: pedido.orcamento.grafica.nome,
        clienteNome: pedido.orcamento.cliente.nome,
        clienteTelefone: normalizarTelefone(pedido.orcamento.cliente.telefone),
        statusAnterior,
        statusNovo: proximoStatus,
        orcamentoId: pedido.orcamentoId,
      })
    );
  }

  // E-mail aos responsáveis pela etapa que o pedido acabou de ENTRAR — só
  // pras etapas atribuíveis DESTA gráfica (ver etapas.estagiosAtribuiveis
  // acima); ENTREGUE nunca dispara isso porque não há mais nenhuma
  // transição a confirmar depois.
  if (etapas.estagiosAtribuiveis.some((estagio) => estagio.valor === proximoStatus)) {
    const responsaveis = await prisma.usuario.findMany({
      where: { graficaId: pedido.graficaId, responsaveisEstagio: { some: { status: proximoStatus } } },
      select: { email: true },
    });
    if (responsaveis.length > 0) {
      // Backfill lazy: pedidos criados antes desta feature não têm token
      // ainda. Pedidos novos já nascem com ele (ver criação do Pedido em
      // orcamento/[id]/actions.ts e o/[token]/actions.ts).
      let token = pedido.producaoLinkToken;
      if (!token) {
        token = randomBytes(20).toString("base64url");
        await prisma.pedido.update({ where: { id: pedido.id }, data: { producaoLinkToken: token } });
      }
      const origem = await resolverOrigemPublica();
      const link = `${origem}/p/${token}`;
      const itensResumo = pedido.orcamento.itens.map((item) => ({
        nome: item.itemGrafica.itemCatalogo.nome,
        quantidade: item.quantidade,
      }));
      const template = templateEstagioResponsavel(
        pedido.orcamento.grafica.nome,
        pedido.orcamento.cliente.nome,
        etapas.rotulos[proximoStatus],
        itensResumo,
        link,
        pedido.orcamento.grafica.corPrimaria
      );
      for (const responsavel of responsaveis) {
        // after() em vez de void: garante que a instância serverless
        // continua viva até o e-mail terminar, mesmo depois da resposta já
        // ter sido enviada ao cliente.
        after(() =>
          dispararEventoEmail({ tipo: "estagio_responsavel", destinatario: responsavel.email, ...template })
        );
      }
    }
  }

  revalidatePath("/producao");
  revalidatePath(`/orcamento/${pedido.orcamentoId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");

  return {
    ok: true,
    mensagem: `Avançado para ${etapas.rotulos[proximoStatus]}.`,
    statusAnterior,
    proximoStatus,
  };
}
