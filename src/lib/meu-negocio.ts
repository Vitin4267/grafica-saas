import "server-only";

import { prisma } from "@/lib/prisma";
import { ROTULOS_STATUS_ORCAMENTO, type StatusOrcamento } from "@/lib/orcamento-status";

const ORDEM_STATUS_ORCAMENTO: StatusOrcamento[] = [
  "RASCUNHO",
  "ENVIADO",
  "APROVADO",
  "REJEITADO",
];

const ORDEM_STATUS_PEDIDO = ["FILA", "IMPRESSAO", "ACABAMENTO", "PRONTO", "ENTREGUE"] as const;

const ROTULOS_STATUS_PEDIDO: Record<(typeof ORDEM_STATUS_PEDIDO)[number], string> = {
  FILA: "Na fila",
  IMPRESSAO: "Impressão",
  ACABAMENTO: "Acabamento",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
};

export type FaixaStatus = { status: string; rotulo: string; quantidade: number };

export type VisaoGeralNegocio = {
  faturamentoMes: { total: number; quantidadeAprovados: number };
  funilOrcamentos: FaixaStatus[];
  totalOrcamentos: number;
  pipelineProducao: FaixaStatus[];
  totalPedidos: number;
  itensBaixoEstoque: { id: string; nome: string; estoqueAtual: number; estoqueMinimo: number }[];
  temItensComEstoqueControlado: boolean;
  topClientes: { id: string; nome: string; total: number }[];
  totalClientes: number;
  produtosAtivos: number;
  orcamentosDoMes: number;
};

export async function buscarVisaoGeralNegocio(graficaId: string): Promise<VisaoGeralNegocio> {
  const agora = new Date();
  const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1);

  const [
    faturamentoAgregado,
    funilBruto,
    pipelineBruto,
    itensComEstoque,
    topClientesBruto,
    totalClientes,
    produtosAtivos,
    orcamentosDoMes,
  ] = await Promise.all([
    prisma.orcamento.aggregate({
      where: { graficaId, status: "APROVADO", createdAt: { gte: inicioDoMes } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.orcamento.groupBy({
      by: ["status"],
      where: { graficaId },
      _count: true,
    }),
    prisma.pedido.groupBy({
      by: ["status"],
      where: { graficaId },
      _count: true,
    }),
    prisma.itemGrafica.findMany({
      where: {
        graficaId,
        ativo: true,
        estoqueAtual: { not: null },
        estoqueMinimo: { not: null },
      },
      include: { itemCatalogo: true },
    }),
    prisma.orcamento.groupBy({
      by: ["clienteId"],
      where: { graficaId, status: "APROVADO" },
      _sum: { total: true },
      orderBy: { _sum: { total: "desc" } },
      take: 5,
    }),
    prisma.cliente.count({ where: { graficaId } }),
    prisma.itemGrafica.count({ where: { graficaId, ativo: true } }),
    prisma.orcamento.count({ where: { graficaId, createdAt: { gte: inicioDoMes } } }),
  ]);

  const contagemPorStatusOrcamento = new Map(
    funilBruto.map((g) => [g.status, g._count])
  );
  const funilOrcamentos = ORDEM_STATUS_ORCAMENTO.map((status) => ({
    status,
    rotulo: ROTULOS_STATUS_ORCAMENTO[status],
    quantidade: contagemPorStatusOrcamento.get(status) ?? 0,
  }));
  const totalOrcamentos = funilOrcamentos.reduce((soma, f) => soma + f.quantidade, 0);

  const contagemPorStatusPedido = new Map(pipelineBruto.map((g) => [g.status, g._count]));
  const pipelineProducao = ORDEM_STATUS_PEDIDO.map((status) => ({
    status,
    rotulo: ROTULOS_STATUS_PEDIDO[status],
    quantidade: contagemPorStatusPedido.get(status) ?? 0,
  }));
  const totalPedidos = pipelineProducao.reduce((soma, f) => soma + f.quantidade, 0);

  const itensBaixoEstoque = itensComEstoque
    .map((item) => ({
      id: item.id,
      nome: item.itemCatalogo.nome,
      estoqueAtual: Number(item.estoqueAtual),
      estoqueMinimo: Number(item.estoqueMinimo),
    }))
    .filter((item) => item.estoqueAtual <= item.estoqueMinimo)
    .sort(
      (a, b) =>
        a.estoqueAtual - a.estoqueMinimo - (b.estoqueAtual - b.estoqueMinimo)
    )
    .slice(0, 5);

  // TODO(review): roda incondicionalmente, mesmo quando topClientesBruto está
  // vazio (gráfica nova, nenhum orçamento aprovado ainda) — vira um round trip
  // ao banco garantidamente vazio (`id: { in: [] } }`). Um early-return/guard
  // evitaria essa 9ª query solta em toda carga do /meu-negocio.
  const clientesTop = await prisma.cliente.findMany({
    where: { id: { in: topClientesBruto.map((c) => c.clienteId) } },
    select: { id: true, nome: true },
  });
  const nomeClientePorId = new Map(clientesTop.map((c) => [c.id, c.nome]));
  const topClientes = topClientesBruto.map((c) => ({
    id: c.clienteId,
    nome: nomeClientePorId.get(c.clienteId) ?? "Cliente",
    total: Number(c._sum.total ?? 0),
  }));

  return {
    faturamentoMes: {
      total: Number(faturamentoAgregado._sum.total ?? 0),
      quantidadeAprovados: faturamentoAgregado._count,
    },
    funilOrcamentos,
    totalOrcamentos,
    pipelineProducao,
    totalPedidos,
    itensBaixoEstoque,
    temItensComEstoqueControlado: itensComEstoque.length > 0,
    topClientes,
    totalClientes,
    produtosAtivos,
    orcamentosDoMes,
  };
}
