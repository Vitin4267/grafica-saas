import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Conjunto sugerido de categorias — inspirado na planilha real de controle de
// custo de uma gráfica cliente (papel, ferramental, laminação, clichê,
// impressão, frete, mão de obra, retrabalho, comissão). Só usado como PONTO
// DE PARTIDA na primeira vez que a gráfica abre a tela de configuração de
// custo — depois disso a gráfica é livre pra renomear/desativar/criar as
// suas próprias, nunca fixo em código daqui pra frente (mesmo princípio já
// aplicado a UnidadeDimensao: cada gráfica trabalha de um jeito).
export const CATEGORIAS_CUSTO_SUGERIDAS = [
  "Papel",
  "Ferramental (faca)",
  "Laminação",
  "Clichê",
  "Impressão",
  "Frete",
  "Mão de obra",
  "Retrabalho",
  "Comissão",
];

// Espelha a comissão do vendedor (model Comissao) como um CustoPedido, só
// quando ParametrosGrafica.comissaoEntraNoCustoPedido está ligado (achado
// A1-Parte6 da auditoria de abrangência, 2026-08-24 — campo existia no
// schema sem nenhum consumidor). Sem isso, Comissao e CustoPedido nunca se
// tocam e lucroDoPedido nunca desconta a comissão paga ao vendedor.
// OrigemCusto.COMISSAO já existe no enum, sem nenhum código usando antes
// desta função. Mesmo estilo defensivo de criarCustoAutomaticoConsumo (ver
// src/app/producao/status-transicao.ts): nunca lança — a aprovação do
// orçamento não pode falhar por causa disto.
export async function criarCustoAutomaticoComissao(
  tx: Prisma.TransactionClient,
  params: { graficaId: string; pedidoId: string; valorComissao: number }
): Promise<void> {
  if (params.valorComissao <= 0) return;

  // Prefere uma categoria chamada "Comissão" (a sugerida em
  // CATEGORIAS_CUSTO_SUGERIDAS acima) — tenant que já tinha categorias antes
  // desta feature não ganha "Comissão" retroativamente (garantirCategoriasCustoPadrao
  // só roda com zero categorias), então cai no fallback abaixo.
  const categoria =
    (await tx.categoriaCusto.findFirst({
      where: { graficaId: params.graficaId, ativa: true, nome: { equals: "Comissão", mode: "insensitive" } },
      select: { id: true },
    })) ??
    (await tx.categoriaCusto.findFirst({
      where: { graficaId: params.graficaId, ativa: true },
      orderBy: { ordem: "asc" },
      select: { id: true },
    }));

  if (!categoria) {
    console.error(
      `[custo-automatico] Gráfica ${params.graficaId} sem nenhuma CategoriaCusto ativa — CustoPedido de comissão do pedido ${params.pedidoId} não foi criado.`
    );
    return;
  }

  // Mesmo cuidado de criarCustoAutomaticoConsumo: nunca soma calado em cima
  // de um custo MANUAL já lançado na mesma categoria — só marca
  // possivelDuplicidade pra UI resolver.
  const existeManualMesmaCategoria = await tx.custoPedido.findFirst({
    where: { pedidoId: params.pedidoId, categoriaCustoId: categoria.id, origem: "MANUAL" },
    select: { id: true },
  });

  await tx.custoPedido.create({
    data: {
      graficaId: params.graficaId,
      pedidoId: params.pedidoId,
      categoriaCustoId: categoria.id,
      origem: "COMISSAO",
      valor: params.valorComissao,
      valorCalculado: params.valorComissao,
      possivelDuplicidade: existeManualMesmaCategoria !== null,
    },
  });
}

// Idempotente: só cria as categorias sugeridas se a gráfica ainda não tem
// NENHUMA linha cadastrada. Se a gráfica já tinha categorias e apagou todas
// de propósito, isto NUNCA recria sozinho — ausência de linhas depois da
// primeira vez é uma escolha da gráfica, não "esqueceu de configurar".
// Chamado sob demanda pela tela de configuração (lazy-bootstrap), em vez de
// tocar no fluxo de criação de conta/gráfica em múltiplos pontos de entrada
// (/registro, /comecar, /admin/graficas).
export async function garantirCategoriasCustoPadrao(graficaId: string): Promise<void> {
  const existentes = await prisma.categoriaCusto.count({ where: { graficaId } });
  if (existentes > 0) return;

  await prisma.categoriaCusto.createMany({
    data: CATEGORIAS_CUSTO_SUGERIDAS.map((nome, indice) => ({
      graficaId,
      nome,
      ordem: indice,
    })),
  });
}

export type CustoPorCategoria = {
  categoriaId: string;
  categoriaNome: string;
  total: number;
};

export type LucroPedido = {
  receita: number;
  custoTotal: number;
  lucro: number;
  custosPorCategoria: CustoPorCategoria[];
};

// Lucro REAL de um pedido = total do orçamento aprovado (receita) menos a
// soma dos custos REAIS lançados em CustoPedido — diferente do "custo
// estimado" que o motor de precificação já guarda em
// OrcamentoItem.breakdown, que é uma previsão feita na hora do orçamento,
// nunca atualizada depois. Retorna null se o pedido não existir (chamador
// decide o que fazer — normalmente notFound()).
export async function lucroDoPedido(pedidoId: string): Promise<LucroPedido | null> {
  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    select: {
      orcamento: { select: { total: true } },
      // estornadoEm: null — custo automático estornado no cancelamento do
      // pedido (fase "custo real" §3.3) some da soma de lucro sem nunca ser
      // apagado do banco (histórico preservado, só sai da conta).
      custos: {
        where: { estornadoEm: null },
        select: {
          valor: true,
          categoriaCusto: { select: { id: true, nome: true } },
        },
      },
    },
  });
  if (!pedido) return null;

  const porCategoria = new Map<string, CustoPorCategoria>();
  let custoTotal = 0;
  for (const custo of pedido.custos) {
    const valor = Number(custo.valor);
    custoTotal += valor;
    const existente = porCategoria.get(custo.categoriaCusto.id);
    if (existente) {
      existente.total += valor;
    } else {
      porCategoria.set(custo.categoriaCusto.id, {
        categoriaId: custo.categoriaCusto.id,
        categoriaNome: custo.categoriaCusto.nome,
        total: valor,
      });
    }
  }

  const receita = Number(pedido.orcamento.total);
  return {
    receita,
    custoTotal,
    lucro: receita - custoTotal,
    custosPorCategoria: [...porCategoria.values()].sort((a, b) => b.total - a.total),
  };
}

// Agregação de custos por categoria pra TODA a gráfica, num intervalo de
// datas — alimenta o gráfico "custos por categoria" do Meu Negócio. Filtra
// pela data de CRIAÇÃO do lançamento de custo (CustoPedido.createdAt), não
// pela data do pedido/orçamento — é quando o gasto foi de fato registrado.
// clienteId é opcional (filtro de "relatórios completos" em /meu-negocio):
// quando informado, restringe aos custos de pedidos cujo orçamento é desse
// cliente (join via pedido.orcamento.clienteId, já que CustoPedido não tem
// clienteId direto).
export async function custosPorCategoriaNoPeriodo(
  graficaId: string,
  inicio: Date,
  fim: Date,
  clienteId?: string
): Promise<CustoPorCategoria[]> {
  const linhas = await prisma.custoPedido.groupBy({
    by: ["categoriaCustoId"],
    where: {
      graficaId,
      createdAt: { gte: inicio, lt: fim },
      // Custo estornado (cancelamento de pedido, §3.3) não entra no gráfico
      // de custos por categoria do Meu Negócio — histórico preservado no
      // banco, só excluído da soma.
      estornadoEm: null,
      ...(clienteId ? { pedido: { orcamento: { clienteId } } } : {}),
    },
    _sum: { valor: true },
  });
  if (linhas.length === 0) return [];

  const categorias = await prisma.categoriaCusto.findMany({
    where: { id: { in: linhas.map((l) => l.categoriaCustoId) } },
    select: { id: true, nome: true },
  });
  const nomePorId = new Map(categorias.map((c) => [c.id, c.nome]));

  return linhas
    .map((l) => ({
      categoriaId: l.categoriaCustoId,
      categoriaNome: nomePorId.get(l.categoriaCustoId) ?? "Categoria removida",
      total: Number(l._sum.valor ?? 0),
    }))
    .sort((a, b) => b.total - a.total);
}

// Ids de ItemGrafica (matéria-prima) cujo preço de compra não é atualizado
// há mais dias que ParametrosGrafica.diasPrecoInsumoDesatualizado (default
// 90) — achado A1-Parte6 da auditoria de abrangência (2026-08-24): o campo
// existia no schema sem nenhum código lendo. `precoCompraAtualizadoEm` só é
// carimbado a partir desta feature (ver catalogo/actions.ts e
// catalogo/[itemGraficaId]/actions.ts) — item com o campo `null` (todo
// cadastro anterior a ela, ou item cujo preço nunca foi tocado desde então)
// NUNCA entra no aviso: sem dado é "não sei", nunca "está velho" (mesmo
// princípio de todo campo novo nullable deste projeto).
export async function listarInsumosComPrecoDesatualizado(graficaId: string): Promise<string[]> {
  const parametros = await prisma.parametrosGrafica.findUnique({
    where: { graficaId },
    select: { diasPrecoInsumoDesatualizado: true },
  });
  const dias = parametros?.diasPrecoInsumoDesatualizado ?? 90;
  const limiar = new Date(Date.now() - dias * 86_400_000);

  const itens = await prisma.itemGrafica.findMany({
    where: {
      graficaId,
      ativo: true,
      itemCatalogo: { tipo: "MATERIA_PRIMA" },
      precoCompraAtualizadoEm: { lt: limiar },
    },
    select: { id: true },
  });
  return itens.map((i) => i.id);
}
