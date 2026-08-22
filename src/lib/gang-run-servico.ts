import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { paraDecimal } from "@/lib/pricing/decimal";
import {
  ehCandidatoGangRun,
  calcularFracaoFolha,
  chaveGrupoGangRun,
  agruparPorChave,
  ratearCustoSetup,
  lerDadosOffsetDoBreakdown,
} from "@/lib/gang-run";

// Camada que TOCA banco pro gang run — a lógica pura (candidatura, chave de
// agrupamento, rateio) mora em src/lib/gang-run.ts, 100% testável sem
// Prisma. Aqui só orquestração de leitura/escrita, mesma separação já usada
// no motor de precificação (src/lib/pricing/*.ts puro vs.
// src/lib/pricing/carregar.ts com Prisma).

// Mesmo nome de categoria usado em src/lib/pedido-aprovacao.ts pra separar
// "chapas" na previsão de custo — reaproveitado aqui pra não criar uma
// segunda categoria "conceitual" pro mesmo tipo de custo (chapa de
// impressão). Se a gráfica não tiver essa categoria cadastrada, cai no
// mesmo fallback em cascata que o resto do sistema usa (ver
// montarResolutorCategoria em pedido-aprovacao.ts): categoria padrão da
// gráfica → primeira categoria ativa.
const CATEGORIA_CHAPAS_NOME = "Clichê";

// ---------------------------------------------------------------------------
// Candidatura: chamado dentro da MESMA transação que cria o Pedido, na
// aprovação do orçamento (ver src/app/orcamento/[id]/actions.ts e
// src/app/o/[token]/actions.ts — os dois chamam esta função exatamente do
// mesmo jeito, pra nunca divergir, mesmo princípio de
// gravarPrevisaoAprovacaoPedido).
// ---------------------------------------------------------------------------

export async function registrarCandidatosGangRun(
  tx: Prisma.TransactionClient,
  params: { graficaId: string; orcamentoId: string; pedidoId: string }
): Promise<void> {
  // Só item OFFSET pode ser candidato (gang run é sobre dividir uma chapa
  // física — M2/FLEXOGRAFIA/SIMPLES não têm esse conceito). Lido aqui, não
  // recebido de fora, pra esta função ficar auto-contida e não depender do
  // shape exato que cada chamador já tinha carregado pra outro propósito
  // (ex: orcamentoComItens em orcamento/[id]/actions.ts só seleciona
  // itemGrafica.precoCompra hoje).
  const itens = await tx.orcamentoItem.findMany({
    where: { orcamentoId: params.orcamentoId, modeloCalculo: "OFFSET" },
    select: {
      id: true,
      quantidade: true,
      corFrente: true,
      corVerso: true,
      breakdown: true,
      itemGrafica: { select: { papelId: true, gramaturaGm2: true, prensaId: true } },
    },
  });
  if (itens.length === 0) return;

  const candidatos: Prisma.FilaGangRunCreateManyInput[] = [];
  for (const item of itens) {
    const { papelId, gramaturaGm2, prensaId } = item.itemGrafica;
    // Defensivo: modeloCalculo=OFFSET deveria sempre ter os três campos
    // preenchidos (obrigatório na aplicação, ver comentário de ItemGrafica
    // no schema), mas nunca inventa um agrupamento com dado ausente —
    // simplesmente não candidata o item.
    if (!papelId || gramaturaGm2 === null || !prensaId) continue;
    if (item.corFrente === null || item.corVerso === null) continue;

    const dados = lerDadosOffsetDoBreakdown(item.breakdown);
    if (!dados) continue;
    if (!ehCandidatoGangRun(item.quantidade, dados.nUp)) continue;

    candidatos.push({
      graficaId: params.graficaId,
      orcamentoItemId: item.id,
      pedidoId: params.pedidoId,
      papelId,
      gramaturaGm2,
      prensaId,
      folhaId: dados.folhaId,
      corFrente: item.corFrente,
      corVerso: item.corVerso,
      nUpPeca: dados.nUp,
      quantidadePeca: item.quantidade,
      fracaoFolha: calcularFracaoFolha(item.quantidade, dados.nUp).toFixed(4),
      custoChapasIndividual: dados.custoChapas.toFixed(2),
      custoSetupIndividual: dados.custoSetup.toFixed(2),
    });
  }
  if (candidatos.length === 0) return;

  // skipDuplicates: orcamentoItemId é @unique em FilaGangRun — defensivo
  // contra retry (a aprovação em si só acontece uma vez, garantida pelo CAS
  // de status do Orcamento), nunca duplica um candidato pro mesmo item.
  await tx.filaGangRun.createMany({ data: candidatos, skipDuplicates: true });
}

// ---------------------------------------------------------------------------
// Cancelamento: chamado de dentro da transação de cancelarPedido (ver
// src/app/producao/actions.ts) — só tira da FILA quem ainda está
// AGUARDANDO. Um candidato já COMBINADO não é desfeito aqui: o custo
// GANG_RUN já foi rateado e lançado em CIMA de outros pedidos do mesmo
// grupo (não só neste), então desfazer automaticamente deixaria o rateio
// dos outros itens inconsistente com o que de fato foi cobrado na chapa
// física já rodada. Fora do MVP — ver resumo da feature: reverter um grupo
// já combinado é ação manual (lançar um custo negativo/estorno manual),
// igual ao tratamento que custo MANUAL já recebe no cancelamento normal
// (frete pago é frete pago).
// ---------------------------------------------------------------------------

export async function cancelarCandidatosDoPedido(
  tx: Prisma.TransactionClient,
  pedidoId: string,
  motivo: string
): Promise<void> {
  await tx.filaGangRun.updateMany({
    where: { pedidoId, status: "AGUARDANDO" },
    data: { status: "CANCELADO", canceladoEm: new Date(), motivoCancelamento: motivo },
  });
}

// ---------------------------------------------------------------------------
// Combinação: ação manual do operador na tela /producao/gang-run — recebe
// os ids de FilaGangRun escolhidos (têm que ser >= 2, da MESMA chave física,
// todos ainda AGUARDANDO) e comita o rateio como CustoPedido real.
// ---------------------------------------------------------------------------

export type ResultadoCombinarGangRun =
  | { ok: true; grupoId: string; custoTotal: string; itensCombinados: number }
  | { ok: false; mensagem: string };

async function resolverCategoriaCustoGangRun(
  tx: Prisma.TransactionClient,
  graficaId: string
): Promise<string | null> {
  // Mesma cascata de 3 níveis usada em montarResolutorCategoria
  // (pedido-aprovacao.ts) e no custo automático de consumo
  // (status-transicao.ts), só que preferindo a categoria "Clichê" antes da
  // padrão da gráfica — o custo de gang run É fundamentalmente custo de
  // chapa. Sem essa categoria cadastrada, cai na mesma cascata de sempre.
  const [chapas, parametros, primeiraAtiva] = await Promise.all([
    tx.categoriaCusto.findFirst({
      where: { graficaId, ativa: true, nome: CATEGORIA_CHAPAS_NOME },
      select: { id: true },
    }),
    tx.parametrosGrafica.findUnique({
      where: { graficaId },
      select: { categoriaCustoConsumoPadraoId: true },
    }),
    tx.categoriaCusto.findFirst({
      where: { graficaId, ativa: true },
      orderBy: { ordem: "asc" },
      select: { id: true },
    }),
  ]);
  return chapas?.id ?? parametros?.categoriaCustoConsumoPadraoId ?? primeiraAtiva?.id ?? null;
}

export async function combinarGrupoGangRun(params: {
  graficaId: string;
  filaGangRunIds: string[];
  combinadoPorId: string;
}): Promise<ResultadoCombinarGangRun> {
  const idsUnicos = [...new Set(params.filaGangRunIds)];
  if (idsUnicos.length < 2) {
    return { ok: false, mensagem: "Selecione ao menos dois itens pra combinar numa chapa." };
  }

  return prisma.$transaction(async (tx) => {
    const itens = await tx.filaGangRun.findMany({
      where: { id: { in: idsUnicos }, graficaId: params.graficaId },
    });
    if (itens.length !== idsUnicos.length) {
      return { ok: false, mensagem: "Um ou mais itens selecionados não foram encontrados." };
    }
    if (itens.some((item) => item.status !== "AGUARDANDO")) {
      return {
        ok: false,
        mensagem: "Um ou mais itens selecionados já não estão mais aguardando — outra pessoa já combinou ou cancelou.",
      };
    }

    const chaves = new Set(
      itens.map((item) =>
        chaveGrupoGangRun({
          papelId: item.papelId,
          gramaturaGm2: Number(item.gramaturaGm2),
          prensaId: item.prensaId,
          folhaId: item.folhaId,
          corFrente: item.corFrente,
          corVerso: item.corVerso,
        })
      )
    );
    if (chaves.size > 1) {
      return {
        ok: false,
        mensagem: "Os itens selecionados não são fisicamente compatíveis (papel, gramatura, prensa, folha ou cores diferentes).",
      };
    }

    // Custo fixo da rodada compartilhada: chapas/setup do motor Offset não
    // escalam com quantidade (são fixos por combo cor+prensa+folha, ver
    // comentário em src/lib/pricing/offset.ts) — por construção da chave
    // acima, todo item do grupo já tem exatamente o mesmo
    // custoChapasIndividual/custoSetupIndividual, então o primeiro item
    // representa o total da rodada.
    const custoChapasTotal = paraDecimal(itens[0].custoChapasIndividual.toString());
    const custoSetupTotal = paraDecimal(itens[0].custoSetupIndividual.toString());
    const custoTotal = custoChapasTotal.plus(custoSetupTotal);

    const grupo = await tx.grupoGangRun.create({
      data: {
        graficaId: params.graficaId,
        papelId: itens[0].papelId,
        gramaturaGm2: itens[0].gramaturaGm2,
        prensaId: itens[0].prensaId,
        folhaId: itens[0].folhaId,
        corFrente: itens[0].corFrente,
        corVerso: itens[0].corVerso,
        custoChapasTotal: custoChapasTotal.toFixed(2),
        custoSetupTotal: custoSetupTotal.toFixed(2),
        combinadoPorId: params.combinadoPorId,
      },
    });

    const rateio = ratearCustoSetup(
      itens.map((item) => ({ id: item.id, fracaoFolha: item.fracaoFolha.toString() })),
      custoTotal
    );

    const categoriaCustoId = await resolverCategoriaCustoGangRun(tx, params.graficaId);

    for (const item of itens) {
      const fatia = rateio.get(item.id) ?? paraDecimal(0);
      await tx.filaGangRun.update({
        where: { id: item.id },
        data: { status: "COMBINADO", grupoGangRunId: grupo.id, custoRateado: fatia.toFixed(2) },
      });

      // Sem categoria de custo cadastrada na gráfica (defensivo — não
      // deveria acontecer, garantirCategoriasCustoPadrao roda no
      // bootstrap): a fila ainda é resolvida (FilaGangRun sai de
      // AGUARDANDO), só o lançamento financeiro em CustoPedido é pulado —
      // mesmo tratamento defensivo de criarCustoAutomaticoConsumo em
      // status-transicao.ts.
      if (categoriaCustoId && fatia.gt(0)) {
        await tx.custoPedido.create({
          data: {
            graficaId: params.graficaId,
            pedidoId: item.pedidoId,
            categoriaCustoId,
            origem: "GANG_RUN",
            valor: fatia.toFixed(2),
            valorCalculado: fatia.toFixed(2),
            criadoPorId: params.combinadoPorId,
            observacao: `Rateio de chapa + acerto do gang run — grupo ${grupo.id}, ${itens.length} pedidos compartilhando a chapa.`,
          },
        });
      }
    }

    return { ok: true, grupoId: grupo.id, custoTotal: custoTotal.toFixed(2), itensCombinados: itens.length };
  });
}

// ---------------------------------------------------------------------------
// Leitura pra tela /producao/gang-run — agrupa os candidatos AGUARDANDO da
// gráfica pela mesma chave física usada pra decidir compatibilidade
// (chaveGrupoGangRun), com os nomes já resolvidos pra exibição.
// ---------------------------------------------------------------------------

export type CandidatoGangRunListado = {
  id: string;
  pedidoId: string;
  clienteNome: string;
  produtoNome: string;
  quantidadePeca: number;
  nUpPeca: number;
  fracaoFolha: number;
  criadoEm: Date;
};

export type GrupoGangRunListado = {
  chave: string;
  papelNome: string;
  gramaturaGm2: number;
  prensaNome: string;
  folhaNome: string;
  corFrente: number;
  corVerso: number;
  somaFracaoFolha: number;
  candidatos: CandidatoGangRunListado[];
};

export async function listarFilaGangRunAgrupada(graficaId: string): Promise<GrupoGangRunListado[]> {
  const itens = await prisma.filaGangRun.findMany({
    where: { graficaId, status: "AGUARDANDO" },
    include: {
      orcamentoItem: { select: { itemGrafica: { select: { itemCatalogo: { select: { nome: true } } } } } },
      pedido: { select: { id: true, orcamento: { select: { cliente: { select: { nome: true } } } } } },
    },
    orderBy: { criadoEm: "asc" },
  });
  if (itens.length === 0) return [];

  // Nomes pra exibição não estão desnormalizados em FilaGangRun (é
  // deliberado — ver comentário no schema: é um snapshot de agrupamento, não
  // um vínculo mantido consistente) — resolvidos aqui, em lote, pra não
  // fazer N+1 por item.
  const papelIds = [...new Set(itens.map((i) => i.papelId))];
  const prensaIds = [...new Set(itens.map((i) => i.prensaId))];
  const folhaIds = [...new Set(itens.map((i) => i.folhaId))];
  const [papeis, prensas, folhas] = await Promise.all([
    prisma.itemGrafica.findMany({
      where: { id: { in: papelIds } },
      select: { id: true, itemCatalogo: { select: { nome: true } } },
    }),
    prisma.prensa.findMany({ where: { id: { in: prensaIds } }, select: { id: true, nome: true } }),
    prisma.formatoFolha.findMany({ where: { id: { in: folhaIds } }, select: { id: true, nome: true } }),
  ]);
  const nomePapel = new Map(papeis.map((p) => [p.id, p.itemCatalogo.nome]));
  const nomePrensa = new Map(prensas.map((p) => [p.id, p.nome]));
  const nomeFolha = new Map(folhas.map((f) => [f.id, f.nome]));

  const grupos = agruparPorChave(itens, (item) =>
    chaveGrupoGangRun({
      papelId: item.papelId,
      gramaturaGm2: Number(item.gramaturaGm2),
      prensaId: item.prensaId,
      folhaId: item.folhaId,
      corFrente: item.corFrente,
      corVerso: item.corVerso,
    })
  );

  const resultado: GrupoGangRunListado[] = [];
  for (const [chave, itensDoGrupo] of grupos) {
    const primeiro = itensDoGrupo[0];
    const candidatos: CandidatoGangRunListado[] = itensDoGrupo.map((item) => ({
      id: item.id,
      pedidoId: item.pedido.id,
      clienteNome: item.pedido.orcamento.cliente.nome,
      produtoNome: item.orcamentoItem.itemGrafica.itemCatalogo.nome,
      quantidadePeca: item.quantidadePeca,
      nUpPeca: item.nUpPeca,
      fracaoFolha: Number(item.fracaoFolha),
      criadoEm: item.criadoEm,
    }));
    resultado.push({
      chave,
      papelNome: nomePapel.get(primeiro.papelId) ?? "Papel removido",
      gramaturaGm2: Number(primeiro.gramaturaGm2),
      prensaNome: nomePrensa.get(primeiro.prensaId) ?? "Prensa removida",
      folhaNome: nomeFolha.get(primeiro.folhaId) ?? "Formato removido",
      corFrente: primeiro.corFrente,
      corVerso: primeiro.corVerso,
      somaFracaoFolha: candidatos.reduce((soma, c) => soma + c.fracaoFolha, 0),
      candidatos,
    });
  }

  // Grupos que já preenchem (ou passam de) uma chapa inteira primeiro — são
  // os que mais valem a pena combinar agora; dentro do grupo, mais itens
  // aguardando primeiro (mais "pronto pra decidir"), com o mais antigo
  // como desempate.
  resultado.sort((a, b) => {
    const prontidao = Number(b.somaFracaoFolha >= 1) - Number(a.somaFracaoFolha >= 1);
    if (prontidao !== 0) return prontidao;
    if (b.candidatos.length !== a.candidatos.length) return b.candidatos.length - a.candidatos.length;
    return b.somaFracaoFolha - a.somaFracaoFolha;
  });

  return resultado;
}
