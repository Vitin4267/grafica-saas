import "server-only";
import { prisma } from "@/lib/prisma";

// Conjunto sugerido de categorias — inspirado na planilha real de controle de
// custo de uma gráfica cliente (papel, ferramental, laminação, clichê,
// impressão, frete, mão de obra, retrabalho). Só usado como PONTO DE PARTIDA
// na primeira vez que a gráfica abre a tela de configuração de custo — depois
// disso a gráfica é livre pra renomear/desativar/criar as suas próprias,
// nunca fixo em código daqui pra frente (mesmo princípio já aplicado a
// UnidadeDimensao: cada gráfica trabalha de um jeito).
export const CATEGORIAS_CUSTO_SUGERIDAS = [
  "Papel",
  "Ferramental (faca)",
  "Laminação",
  "Clichê",
  "Impressão",
  "Frete",
  "Mão de obra",
  "Retrabalho",
];

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
