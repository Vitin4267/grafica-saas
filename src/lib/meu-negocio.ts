import "server-only";

import { prisma } from "@/lib/prisma";
import { ROTULOS_STATUS_ORCAMENTO, type StatusOrcamento } from "@/lib/orcamento-status";
import { calcularPrevisaoEstoque } from "@/lib/previsao-estoque-db";
import { LIMITE_DIAS_ALERTA } from "@/lib/previsao-estoque";

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
  // Alerta unifica dois sinais: já abaixo do mínimo cadastrado (reativo) OU
  // previsão de acabar em até LIMITE_DIAS_ALERTA dias pelo consumo real
  // (preditivo) — ver src/lib/previsao-estoque.ts. diasRestantes/
  // dataPrevistaEsgotamento são null quando não há histórico suficiente pra
  // calcular a taxa de consumo.
  alertasEstoque: {
    id: string;
    nome: string;
    estoqueAtual: number;
    estoqueMinimo: number | null;
    diasRestantes: number | null;
    dataPrevistaEsgotamento: Date | null;
  }[];
  temItensComEstoqueControlado: boolean;
  topClientes: { id: string; nome: string; total: number }[];
  totalClientes: number;
  produtosAtivos: number;
  orcamentosDoMes: number;
  // "a pagar este mês" (por vencimento) e "pago este mês" (por pagoEm) são
  // perguntas diferentes — não dá pra resumir numa métrica só. saldoReal é
  // caixa de verdade (o que entrou menos o que de fato saiu), não inclui o
  // que ainda está pendente.
  despesasPendentesMes: { total: number; quantidade: number };
  despesasPagasMes: { total: number };
  saldoReal: number;
};

export async function buscarVisaoGeralNegocio(graficaId: string): Promise<VisaoGeralNegocio> {
  const agora = new Date();
  const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1);

  const [
    faturamentoAgregado,
    funilBruto,
    pipelineBruto,
    previsaoEstoque,
    topClientesBruto,
    totalClientes,
    produtosAtivos,
    orcamentosDoMes,
    despesasPendentesAgregado,
    despesasPagasAgregado,
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
    calcularPrevisaoEstoque(graficaId),
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
    prisma.despesa.aggregate({
      where: { graficaId, status: "PENDENTE", vencimento: { gte: inicioDoMes } },
      _sum: { valor: true },
      _count: true,
    }),
    prisma.despesa.aggregate({
      where: { graficaId, status: "PAGA", pagoEm: { gte: inicioDoMes } },
      _sum: { valor: true },
    }),
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

  // alertasEstoque já vem ordenado por urgência (calcularPrevisaoEstoque) —
  // filtra só quem realmente merece alerta: previsão de acabar logo OU já
  // abaixo do mínimo cadastrado.
  const alertasEstoque = previsaoEstoque
    .filter(
      (item) =>
        (item.diasRestantes !== null && item.diasRestantes <= LIMITE_DIAS_ALERTA) ||
        item.abaixoDoMinimo
    )
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      nome: item.nome,
      estoqueAtual: item.estoqueAtual,
      estoqueMinimo: item.estoqueMinimo,
      diasRestantes: item.diasRestantes,
      dataPrevistaEsgotamento: item.dataPrevistaEsgotamento,
    }));

  // Evita um round trip ao banco garantidamente vazio (gráfica nova, nenhum
  // orçamento aprovado ainda).
  const clientesTop =
    topClientesBruto.length === 0
      ? []
      : await prisma.cliente.findMany({
          where: { id: { in: topClientesBruto.map((c) => c.clienteId) } },
          select: { id: true, nome: true },
        });
  const nomeClientePorId = new Map(clientesTop.map((c) => [c.id, c.nome]));
  const topClientes = topClientesBruto.map((c) => ({
    id: c.clienteId,
    nome: nomeClientePorId.get(c.clienteId) ?? "Cliente",
    total: Number(c._sum.total ?? 0),
  }));

  const faturamentoTotal = Number(faturamentoAgregado._sum.total ?? 0);
  const despesasPagasTotal = Number(despesasPagasAgregado._sum.valor ?? 0);

  return {
    faturamentoMes: {
      total: faturamentoTotal,
      quantidadeAprovados: faturamentoAgregado._count,
    },
    funilOrcamentos,
    totalOrcamentos,
    pipelineProducao,
    totalPedidos,
    alertasEstoque,
    temItensComEstoqueControlado: previsaoEstoque.length > 0,
    topClientes,
    totalClientes,
    produtosAtivos,
    orcamentosDoMes,
    despesasPendentesMes: {
      total: Number(despesasPendentesAgregado._sum.valor ?? 0),
      quantidade: despesasPendentesAgregado._count,
    },
    despesasPagasMes: { total: despesasPagasTotal },
    saldoReal: faturamentoTotal - despesasPagasTotal,
  };
}
