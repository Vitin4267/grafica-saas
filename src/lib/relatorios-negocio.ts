import "server-only";

import { prisma } from "@/lib/prisma";
import { D } from "@/lib/pricing/decimal";
import { anoMesBrasilia, limitesMesBrasilia } from "@/lib/data";
import { custosPorCategoriaNoPeriodo, type CustoPorCategoria } from "@/lib/custo-pedido";

const TOP_CLIENTES = 5;
const TOP_PRODUTOS = 8;
const MESES_JANELA_RANKING = 12;

export type FiltroRelatorio = {
  graficaId: string;
  // Instante real (createdAt), inclusive/exclusivo — sempre já resolvido pra
  // fronteira de Brasília por quem chama (ver limitesDiaBrasilia/
  // inicioMesAtualBrasilia em src/lib/data.ts). Esta lib não decide fuso,
  // só recebe os limites prontos.
  inicio: Date;
  fim: Date;
  clienteId?: string;
};

export type MetricasPeriodo = {
  faturado: number;
  pedidos: number;
  // null = sem pedidos no período — quem exibe mostra "—", nunca NaN/Infinity.
  ticketMedio: number | null;
  custos: number;
  lucro: number;
  // percentual (ex: 23.5 = 23,5%). null = sem faturamento no período.
  margem: number | null;
};

export type ClienteRanking = { id: string; nome: string; total: number };
export type ProdutoRanking = { nome: string; quantidade: number; total: number };

export type RelatorioNegocio = {
  metricas: MetricasPeriodo;
  topClientes: ClienteRanking[];
  custosPorCategoria: CustoPorCategoria[];
  produtosMaisVendidos: ProdutoRanking[];
};

// Condição comum de escopo por cliente pra queries sobre Orcamento — extraída
// porque se repete em quase toda agregação desta lib.
function whereClienteOrcamento(clienteId: string | undefined) {
  return clienteId ? { clienteId } : {};
}

export async function buscarRelatorioNegocio(filtro: FiltroRelatorio): Promise<RelatorioNegocio> {
  const { graficaId, inicio, fim, clienteId } = filtro;
  const whereCliente = whereClienteOrcamento(clienteId);

  const [
    faturamentoAgregado,
    pedidosCount,
    custosAgregado,
    topClientesBruto,
    custosPorCategoria,
    produtosBrutos,
  ] = await Promise.all([
    prisma.orcamento.aggregate({
      where: { graficaId, status: "APROVADO", createdAt: { gte: inicio, lt: fim }, ...whereCliente },
      _sum: { total: true },
    }),
    prisma.pedido.count({
      where: { graficaId, orcamento: { createdAt: { gte: inicio, lt: fim }, ...whereCliente } },
    }),
    prisma.custoPedido.aggregate({
      where: {
        graficaId,
        createdAt: { gte: inicio, lt: fim },
        // Custo estornado (cancelamento de pedido, §3.3 da fase "custo
        // real") não pode continuar contando contra o lucro do período.
        estornadoEm: null,
        ...(clienteId ? { pedido: { orcamento: { clienteId } } } : {}),
      },
      _sum: { valor: true },
    }),
    prisma.orcamento.groupBy({
      by: ["clienteId"],
      where: { graficaId, status: "APROVADO", createdAt: { gte: inicio, lt: fim }, ...whereCliente },
      _sum: { total: true },
      orderBy: { _sum: { total: "desc" } },
      take: TOP_CLIENTES,
    }),
    custosPorCategoriaNoPeriodo(graficaId, inicio, fim, clienteId),
    prisma.orcamentoItem.groupBy({
      by: ["itemGraficaId"],
      where: {
        orcamento: { graficaId, status: "APROVADO", createdAt: { gte: inicio, lt: fim }, ...whereCliente },
      },
      _sum: { quantidade: true, precoTotal: true },
      orderBy: { _sum: { quantidade: "desc" } },
      take: TOP_PRODUTOS,
    }),
  ]);

  const faturado = new D(String(faturamentoAgregado._sum.total ?? 0));
  const custos = new D(String(custosAgregado._sum.valor ?? 0));
  const lucro = faturado.minus(custos);

  const metricas: MetricasPeriodo = {
    faturado: faturado.toNumber(),
    pedidos: pedidosCount,
    ticketMedio: pedidosCount > 0 ? faturado.div(pedidosCount).toNumber() : null,
    custos: custos.toNumber(),
    lucro: lucro.toNumber(),
    margem: faturado.gt(0) ? lucro.div(faturado).times(100).toNumber() : null,
  };

  const nomesClientes =
    topClientesBruto.length === 0
      ? []
      : await prisma.cliente.findMany({
          where: { id: { in: topClientesBruto.map((c) => c.clienteId) } },
          select: { id: true, nome: true },
        });
  const nomeClientePorId = new Map(nomesClientes.map((c) => [c.id, c.nome]));
  const topClientes: ClienteRanking[] = topClientesBruto.map((c) => ({
    id: c.clienteId,
    nome: nomeClientePorId.get(c.clienteId) ?? "Cliente",
    total: Number(c._sum.total ?? 0),
  }));

  const nomesProdutos =
    produtosBrutos.length === 0
      ? []
      : await prisma.itemGrafica.findMany({
          where: { id: { in: produtosBrutos.map((p) => p.itemGraficaId) } },
          select: { id: true, itemCatalogo: { select: { nome: true } } },
        });
  const nomeProdutoPorId = new Map(nomesProdutos.map((p) => [p.id, p.itemCatalogo.nome]));
  const produtosMaisVendidos: ProdutoRanking[] = produtosBrutos.map((p) => ({
    nome: nomeProdutoPorId.get(p.itemGraficaId) ?? "Produto removido",
    quantidade: p._sum.quantidade ?? 0,
    total: Number(p._sum.precoTotal ?? 0),
  }));

  return { metricas, topClientes, custosPorCategoria, produtosMaisVendidos };
}

export type RankingGeral = {
  clienteQueMaisComprou: { id: string; nome: string; total: number } | null;
  // Rótulo do período coberto pelo ranking (independente do filtro da tela) —
  // sempre exibido junto, pra não parecer "all-time" quando não é.
  janelaRankingRotulo: string;
  mesQueMaisFaturou: { rotulo: string; total: number } | null;
  faturamentoMesAtual: number;
  faturamentoMesAnterior: number;
  // null = mês anterior sem faturamento algum (sem base pra calcular %).
  variacaoPercentual: number | null;
};

// Seção "ranking" do topo da tela de relatórios — NUNCA lê os filtros da
// página (de/ate/clienteId): sempre janela fixa dos últimos 12 meses, pra dar
// uma visão estável de "quem é o melhor cliente" e "qual foi o melhor mês",
// que faria pouco sentido reagir ao filtro de período que a própria pessoa
// está ajustando ao lado.
export async function buscarRankingGeral(graficaId: string): Promise<RankingGeral> {
  const agora = new Date();
  const { ano: anoAtual, mes: mesAtual } = anoMesBrasilia(agora);

  let anoInicioJanela = anoAtual;
  let mesInicioJanela = mesAtual - (MESES_JANELA_RANKING - 1);
  while (mesInicioJanela < 1) {
    mesInicioJanela += 12;
    anoInicioJanela -= 1;
  }
  const inicioJanela = limitesMesBrasilia(anoInicioJanela, mesInicioJanela).inicio;

  const [clienteTopBruto, orcamentosJanela] = await Promise.all([
    prisma.orcamento.groupBy({
      by: ["clienteId"],
      where: { graficaId, status: "APROVADO", createdAt: { gte: inicioJanela } },
      _sum: { total: true },
      orderBy: { _sum: { total: "desc" } },
      take: 1,
    }),
    prisma.orcamento.findMany({
      where: { graficaId, status: "APROVADO", createdAt: { gte: inicioJanela } },
      select: { createdAt: true, total: true },
    }),
  ]);

  const clienteQueMaisComprou =
    clienteTopBruto.length === 0
      ? null
      : await (async () => {
          const c = clienteTopBruto[0];
          const cliente = await prisma.cliente.findUnique({
            where: { id: c.clienteId },
            select: { nome: true },
          });
          return {
            id: c.clienteId,
            nome: cliente?.nome ?? "Cliente",
            total: Number(c._sum.total ?? 0),
          };
        })();

  // Bucket por "AAAA-MM" no calendário de Brasília — mesma disciplina de D
  // (nunca Number() += em loop) usada em bucketarFaturamentoPorSemana
  // (src/lib/meu-negocio.ts).
  const totalPorMes = new Map<string, InstanceType<typeof D>>();
  for (const o of orcamentosJanela) {
    const { ano, mes } = anoMesBrasilia(o.createdAt);
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    const atual = totalPorMes.get(chave) ?? new D(0);
    totalPorMes.set(chave, atual.plus(String(o.total)));
  }

  let mesQueMaisFaturou: { rotulo: string; total: number } | null = null;
  for (const [chave, total] of totalPorMes.entries()) {
    if (!mesQueMaisFaturou || total.gt(mesQueMaisFaturou.total)) {
      const [ano, mes] = chave.split("-").map(Number);
      mesQueMaisFaturou = { rotulo: rotuloMes(ano, mes), total: total.toNumber() };
    }
  }

  const chaveAtual = `${anoAtual}-${String(mesAtual).padStart(2, "0")}`;
  let anoAnterior = anoAtual;
  let mesAnterior = mesAtual - 1;
  if (mesAnterior < 1) {
    mesAnterior = 12;
    anoAnterior -= 1;
  }
  const chaveAnterior = `${anoAnterior}-${String(mesAnterior).padStart(2, "0")}`;

  const faturamentoMesAtual = (totalPorMes.get(chaveAtual) ?? new D(0)).toNumber();
  const faturamentoAnteriorDec = totalPorMes.get(chaveAnterior) ?? new D(0);
  const faturamentoMesAnterior = faturamentoAnteriorDec.toNumber();
  const variacaoPercentual = faturamentoAnteriorDec.gt(0)
    ? new D(faturamentoMesAtual).minus(faturamentoAnteriorDec).div(faturamentoAnteriorDec).times(100).toNumber()
    : null;

  return {
    clienteQueMaisComprou,
    janelaRankingRotulo: "últimos 12 meses",
    mesQueMaisFaturou,
    faturamentoMesAtual,
    faturamentoMesAnterior,
    variacaoPercentual,
  };
}

const FORMATO_MES_ANO = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
function rotuloMes(ano: number, mesUmBaseado: number): string {
  return FORMATO_MES_ANO.format(new Date(Date.UTC(ano, mesUmBaseado - 1, 1)));
}
