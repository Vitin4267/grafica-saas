import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { paraDecimal } from "@/lib/pricing/decimal";
import {
  ehCandidatoGangRun,
  calcularFracaoFolha,
  chaveGrupoGangRun,
  montarChaveGrupoGangRunDeRegistro,
  agruparPorChave,
  ratearCustoSetup,
  lerDadosOffsetDoBreakdown,
  lerDadosFlexoDoBreakdown,
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
  // Achado F1 (auditoria de abrangência) — só itens de processos com
  // agrupamento/nesting implementado podem ser candidatos: OFFSET
  // (FOLHA_2D, comportamento original) e FLEXOGRAFIA (BOBINA_1D, novo). M2/
  // DIGITAL/SIMPLES/etc não têm esse conceito ainda (TELA_MATRIZ/
  // MESA_PLANA fora de escopo desta rodada — ver enum no schema). Lido
  // aqui, não recebido de fora, pra esta função ficar auto-contida e não
  // depender do shape exato que cada chamador já tinha carregado pra outro
  // propósito (ex: orcamentoComItens em orcamento/[id]/actions.ts só
  // seleciona itemGrafica.precoCompra hoje).
  const itens = await tx.orcamentoItem.findMany({
    where: { orcamentoId: params.orcamentoId, modeloCalculo: { in: ["OFFSET", "FLEXOGRAFIA"] } },
    select: {
      id: true,
      quantidade: true,
      modeloCalculo: true,
      corFrente: true,
      corVerso: true,
      breakdown: true,
      itemGrafica: {
        select: { id: true, papelId: true, gramaturaGm2: true, prensaId: true },
      },
    },
  });
  if (itens.length === 0) return;

  const candidatos: Prisma.FilaGangRunCreateManyInput[] = [];
  for (const item of itens) {
    if (item.modeloCalculo === "OFFSET") {
      const { papelId, gramaturaGm2, prensaId } = item.itemGrafica;
      // Defensivo: modeloCalculo=OFFSET deveria sempre ter os três campos
      // preenchidos (obrigatório na aplicação, ver comentário de
      // ItemGrafica no schema), mas nunca inventa um agrupamento com dado
      // ausente — simplesmente não candidata o item.
      if (!papelId || gramaturaGm2 === null || !prensaId) continue;
      if (item.corFrente === null || item.corVerso === null) continue;

      const dados = lerDadosOffsetDoBreakdown(item.breakdown);
      if (!dados) continue;
      if (!ehCandidatoGangRun(item.quantidade, dados.nUp)) continue;

      candidatos.push({
        graficaId: params.graficaId,
        orcamentoItemId: item.id,
        pedidoId: params.pedidoId,
        // tipoAgrupamento OMITIDO de propósito — tem @default(FOLHA_2D) no
        // schema (coluna com DEFAULT no banco, ver migration), então não
        // precisa vir explícito aqui; candidato OFFSET é sempre FOLHA_2D.
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
      continue;
    }

    // FLEXOGRAFIA — achado F1/BOBINA_1D. Material = o próprio ItemGrafica
    // do produto (ver comentário em ChaveGrupoGangRunInputBobina1D no
    // gang-run.ts: BobinaMaterial não tem uma matéria-prima separada como
    // o papelId do Offset).
    const dados = lerDadosFlexoDoBreakdown(item.breakdown);
    if (!dados) continue;
    if (!ehCandidatoGangRun(item.quantidade, dados.nUp)) continue;

    candidatos.push({
      graficaId: params.graficaId,
      orcamentoItemId: item.id,
      pedidoId: params.pedidoId,
      tipoAgrupamento: "BOBINA_1D",
      itemGraficaMaterialId: item.itemGrafica.id,
      larguraBobinaNominal: dados.larguraBobinaNominal.toFixed(3),
      maquinaFlexografiaId: dados.maquinaFlexografiaId,
      nUpPeca: dados.nUp,
      quantidadePeca: item.quantidade,
      fracaoFolha: calcularFracaoFolha(item.quantidade, dados.nUp).toFixed(4),
      // Flexografia não tem custo de "chapa" individual neste MVP — sempre
      // 0.00, reaproveitando a mesma coluna NOT NULL do FOLHA_2D (ver
      // comentário no schema de FilaGangRun.custoChapasIndividual).
      custoChapasIndividual: "0.00",
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
  | { ok: true; grupoId: string; tipoAgrupamento: string; custoTotal: string; itensCombinados: number }
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
    return { ok: false, mensagem: "Selecione ao menos dois itens pra combinar." };
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

    // Achado F1 — a chave de compatibilidade depende do tipoAgrupamento de
    // cada item (montarChaveGrupoGangRunDeRegistro escolhe o branch certo,
    // ver gang-run.ts); null = tipoAgrupamento sem branch implementado
    // ainda, ou linha com dado faltando — nunca combina nesse caso.
    const chavesMontadas = itens.map((item) => ({
      item,
      chaveInput: montarChaveGrupoGangRunDeRegistro({
        tipoAgrupamento: item.tipoAgrupamento,
        papelId: item.papelId,
        gramaturaGm2: item.gramaturaGm2 !== null ? Number(item.gramaturaGm2) : null,
        prensaId: item.prensaId,
        folhaId: item.folhaId,
        corFrente: item.corFrente,
        corVerso: item.corVerso,
        itemGraficaMaterialId: item.itemGraficaMaterialId,
        larguraBobinaNominal:
          item.larguraBobinaNominal !== null ? Number(item.larguraBobinaNominal) : null,
        maquinaFlexografiaId: item.maquinaFlexografiaId,
      }),
    }));
    if (chavesMontadas.some((c) => c.chaveInput === null)) {
      return {
        ok: false,
        mensagem: "Um ou mais itens selecionados não têm dados de compatibilidade completos — não é possível combinar.",
      };
    }

    const chaves = new Set(
      chavesMontadas.map((c) => chaveGrupoGangRun(c.chaveInput!))
    );
    if (chaves.size > 1) {
      return {
        ok: false,
        mensagem: "Os itens selecionados não são fisicamente compatíveis pra dividir a mesma peça (material, largura/gramatura, máquina/prensa ou cores diferentes).",
      };
    }

    const tipoAgrupamento = itens[0].tipoAgrupamento;

    // Custo fixo da rodada compartilhada: não escala com quantidade (fixo
    // por rodada compartilhada em cada motor de precificação, ver
    // comentário em offset.ts/flexografia.ts) — por construção da chave
    // acima, todo item do grupo já tem exatamente o mesmo
    // custoChapasIndividual/custoSetupIndividual, então o primeiro item
    // representa o total da rodada.
    const custoChapasTotal = paraDecimal(itens[0].custoChapasIndividual.toString());
    const custoSetupTotal = paraDecimal(itens[0].custoSetupIndividual.toString());
    const custoTotal = custoChapasTotal.plus(custoSetupTotal);

    const grupo = await tx.grupoGangRun.create({
      data: {
        graficaId: params.graficaId,
        tipoAgrupamento,
        papelId: itens[0].papelId,
        gramaturaGm2: itens[0].gramaturaGm2,
        prensaId: itens[0].prensaId,
        folhaId: itens[0].folhaId,
        corFrente: itens[0].corFrente,
        corVerso: itens[0].corVerso,
        itemGraficaMaterialId: itens[0].itemGraficaMaterialId,
        larguraBobinaNominal: itens[0].larguraBobinaNominal,
        maquinaFlexografiaId: itens[0].maquinaFlexografiaId,
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
        const descricaoRodada =
          tipoAgrupamento === "FOLHA_2D" ? "chapa + acerto" : "acerto de máquina compartilhado";
        await tx.custoPedido.create({
          data: {
            graficaId: params.graficaId,
            pedidoId: item.pedidoId,
            categoriaCustoId,
            origem: "GANG_RUN",
            valor: fatia.toFixed(2),
            valorCalculado: fatia.toFixed(2),
            criadoPorId: params.combinadoPorId,
            observacao: `Rateio de ${descricaoRodada} do gang run — grupo ${grupo.id}, ${itens.length} pedidos compartilhando a mesma peça.`,
          },
        });
      }
    }

    return {
      ok: true,
      grupoId: grupo.id,
      tipoAgrupamento,
      custoTotal: custoTotal.toFixed(2),
      itensCombinados: itens.length,
    };
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

// Achado F1 — descrição da chave física em texto livre, já formatada por
// tipoAgrupamento (a UI não precisa mais saber os nomes de campo de cada
// tipo, só exibir `descricaoCompatibilidade`). FOLHA_2D preserva o mesmo
// texto/campos de sempre; BOBINA_1D é novo.
export type GrupoGangRunListado = {
  chave: string;
  tipoAgrupamento: string;
  descricaoCompatibilidade: string;
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
  // fazer N+1 por item. Achado F1: os dois blocos (FOLHA_2D/BOBINA_1D) são
  // resolvidos juntos — cada Map só recebe os ids do tipo que os usa (os
  // ids do outro tipo ficam null, filtrados no [...new Set(...)]).
  const papelIds = [...new Set(itens.map((i) => i.papelId).filter((v): v is string => v !== null))];
  const prensaIds = [...new Set(itens.map((i) => i.prensaId).filter((v): v is string => v !== null))];
  const folhaIds = [...new Set(itens.map((i) => i.folhaId).filter((v): v is string => v !== null))];
  const materialIds = [
    ...new Set(itens.map((i) => i.itemGraficaMaterialId).filter((v): v is string => v !== null)),
  ];
  const maquinaFlexoIds = [
    ...new Set(itens.map((i) => i.maquinaFlexografiaId).filter((v): v is string => v !== null)),
  ];
  const [papeis, prensas, folhas, materiais, maquinasFlexo] = await Promise.all([
    prisma.itemGrafica.findMany({
      where: { id: { in: papelIds } },
      select: { id: true, itemCatalogo: { select: { nome: true } } },
    }),
    prisma.prensa.findMany({ where: { id: { in: prensaIds } }, select: { id: true, nome: true } }),
    prisma.formatoFolha.findMany({ where: { id: { in: folhaIds } }, select: { id: true, nome: true } }),
    prisma.itemGrafica.findMany({
      where: { id: { in: materialIds } },
      select: { id: true, itemCatalogo: { select: { nome: true } } },
    }),
    prisma.maquinaFlexografia.findMany({
      where: { id: { in: maquinaFlexoIds } },
      select: { id: true, nome: true },
    }),
  ]);
  const nomePapel = new Map(papeis.map((p) => [p.id, p.itemCatalogo.nome]));
  const nomePrensa = new Map(prensas.map((p) => [p.id, p.nome]));
  const nomeFolha = new Map(folhas.map((f) => [f.id, f.nome]));
  const nomeMaterial = new Map(materiais.map((m) => [m.id, m.itemCatalogo.nome]));
  const nomeMaquinaFlexo = new Map(maquinasFlexo.map((m) => [m.id, m.nome]));

  // Só agrupa itens com chave montável (montarChaveGrupoGangRunDeRegistro
  // retorna null pra tipoAgrupamento sem branch implementado ainda ou dado
  // faltando — defensivo, não deveria acontecer com candidatura normal).
  const itensComChave = itens
    .map((item) => ({
      item,
      chaveInput: montarChaveGrupoGangRunDeRegistro({
        tipoAgrupamento: item.tipoAgrupamento,
        papelId: item.papelId,
        gramaturaGm2: item.gramaturaGm2 !== null ? Number(item.gramaturaGm2) : null,
        prensaId: item.prensaId,
        folhaId: item.folhaId,
        corFrente: item.corFrente,
        corVerso: item.corVerso,
        itemGraficaMaterialId: item.itemGraficaMaterialId,
        larguraBobinaNominal:
          item.larguraBobinaNominal !== null ? Number(item.larguraBobinaNominal) : null,
        maquinaFlexografiaId: item.maquinaFlexografiaId,
      }),
    }))
    .filter((entrada): entrada is { item: (typeof itens)[number]; chaveInput: NonNullable<typeof entrada.chaveInput> } =>
      entrada.chaveInput !== null
    );

  const grupos = agruparPorChave(itensComChave, (entrada) => chaveGrupoGangRun(entrada.chaveInput));

  const resultado: GrupoGangRunListado[] = [];
  for (const [chave, entradasDoGrupo] of grupos) {
    const primeiro = entradasDoGrupo[0].item;
    const candidatos: CandidatoGangRunListado[] = entradasDoGrupo.map(({ item }) => ({
      id: item.id,
      pedidoId: item.pedido.id,
      clienteNome: item.pedido.orcamento.cliente.nome,
      produtoNome: item.orcamentoItem.itemGrafica.itemCatalogo.nome,
      quantidadePeca: item.quantidadePeca,
      nUpPeca: item.nUpPeca,
      fracaoFolha: Number(item.fracaoFolha),
      criadoEm: item.criadoEm,
    }));

    const descricaoCompatibilidade =
      primeiro.tipoAgrupamento === "FOLHA_2D"
        ? `${nomePapel.get(primeiro.papelId!) ?? "Papel removido"} · ${Number(primeiro.gramaturaGm2)}g/m² · ${
            nomePrensa.get(primeiro.prensaId!) ?? "Prensa removida"
          } · Folha ${nomeFolha.get(primeiro.folhaId!) ?? "removida"} · ${primeiro.corFrente}x${primeiro.corVerso} cores`
        : `${nomeMaterial.get(primeiro.itemGraficaMaterialId!) ?? "Material removido"} · Bobina ${Number(
            primeiro.larguraBobinaNominal
          )}m · ${nomeMaquinaFlexo.get(primeiro.maquinaFlexografiaId!) ?? "Máquina removida"}`;

    resultado.push({
      chave,
      tipoAgrupamento: primeiro.tipoAgrupamento,
      descricaoCompatibilidade,
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
