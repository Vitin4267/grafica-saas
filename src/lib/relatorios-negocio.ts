import "server-only";

import { prisma } from "@/lib/prisma";
import { D, type Dec } from "@/lib/pricing/decimal";
import { anoMesBrasilia, limitesMesBrasilia } from "@/lib/data";
import { custosPorCategoriaNoPeriodo, type CustoPorCategoria } from "@/lib/custo-pedido";

const TOP_CLIENTES = 5;
const TOP_PRODUTOS = 8;
const MESES_JANELA_RANKING = 12;
// Limite de linhas da matriz cliente × mês (buscarReceitaPorClienteEMes) —
// clientes além do top N caem numa linha "Outros" agregada, pra não virar
// uma tabela com uma linha por cliente cadastrado.
const TOP_CLIENTES_MATRIZ = 10;

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
  // ESTIMATIVA, não um imposto de fato pago/rastreado — calculada como
  // faturado × ParametrosGrafica.impostoPercent (a mesma alíquota já usada
  // pra formar o preço de venda no motor de precificação, ver
  // src/lib/pricing/compor.ts). Não confundir com uma Despesa real
  // categorizada como imposto: isso exigiria a gráfica lançar cada guia
  // paga, o que não é o padrão de uso hoje. null quando a gráfica nunca
  // configurou `ParametrosGrafica` (nesse caso não estima nada, não
  // assume 0%, que mentiria "sem imposto").
  impostoEstimadoPercent: number | null;
  impostoEstimado: number | null;
  // lucro − impostoEstimado. Ainda NÃO é lucro líquido de verdade (falta
  // rateio de custo fixo — aluguel, salários etc., fora do escopo desta
  // fase, ver fase-custo-real.md §7) — por isso o nome carrega "estimado".
  lucroLiquidoEstimado: number | null;
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
    parametros,
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
    prisma.parametrosGrafica.findUnique({
      where: { graficaId },
      select: { impostoPercent: true },
    }),
  ]);

  const faturado = new D(String(faturamentoAgregado._sum.total ?? 0));
  const custos = new D(String(custosAgregado._sum.valor ?? 0));
  const lucro = faturado.minus(custos);

  // impostoPercent é fração (0.06 = 6%), mesmo campo que já forma o preço de
  // venda no motor — reaproveitado aqui só como referência, nunca escrito.
  const impostoFracao = parametros?.impostoPercent != null ? new D(String(parametros.impostoPercent)) : null;
  const impostoEstimado = impostoFracao ? faturado.times(impostoFracao) : null;
  const lucroLiquidoEstimado = impostoEstimado ? lucro.minus(impostoEstimado) : null;

  const metricas: MetricasPeriodo = {
    faturado: faturado.toNumber(),
    pedidos: pedidosCount,
    ticketMedio: pedidosCount > 0 ? faturado.div(pedidosCount).toNumber() : null,
    custos: custos.toNumber(),
    lucro: lucro.toNumber(),
    margem: faturado.gt(0) ? lucro.div(faturado).times(100).toNumber() : null,
    impostoEstimadoPercent: impostoFracao ? impostoFracao.times(100).toNumber() : null,
    impostoEstimado: impostoEstimado ? impostoEstimado.toNumber() : null,
    lucroLiquidoEstimado: lucroLiquidoEstimado ? lucroLiquidoEstimado.toNumber() : null,
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

// ---------------------------------------------------------------------------
// Visões "mês a mês" e "cliente × mês" (planilha dinâmica que a gráfica
// cliente mantinha manualmente no Excel) — ambas usam a MESMA janela fixa de
// N meses (calendário de Brasília) e a MESMA definição de faturado/custos já
// usada em buscarRelatorioNegocio acima (orçamento aprovado no mês, custo de
// pedido não-estornado no mês), só reagrupada por mês/cliente em vez de somada
// num período único. Nenhuma das duas lê os filtros de/até da tela — mesmo
// espírito de buscarRankingGeral.

const ABREV_MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Rótulo curto "Jan/26" pras colunas das tabelas mensais — abreviação fixa em
// vez de Intl.DateTimeFormat(month:"short") porque o pt-BR do Intl varia
// entre runtimes se o mês curto vem com ou sem ponto final ("jan." vs "jan"),
// e aqui a tabela inteira depende do rótulo ficar estável/previsível.
function rotuloMesCurto(ano: number, mesUmBaseado: number): string {
  return `${ABREV_MESES[mesUmBaseado - 1]}/${String(ano).slice(-2)}`;
}

function chaveMes({ ano, mes }: { ano: number; mes: number }): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

// Lista de {ano,mes} da janela de N meses terminando em anoAtual/mesAtual
// (inclusive), do MAIS ANTIGO (índice 0) pro MAIS RECENTE (último índice) —
// leitura da esquerda pra direita igual a uma planilha "Jan, Fev, Mar...".
function ultimosMeses(
  anoAtual: number,
  mesAtual: number,
  quantidade: number
): { ano: number; mes: number }[] {
  const lista: { ano: number; mes: number }[] = [];
  let ano = anoAtual;
  let mes = mesAtual;
  for (let i = 0; i < quantidade; i++) {
    lista.unshift({ ano, mes });
    mes -= 1;
    if (mes < 1) {
      mes = 12;
      ano -= 1;
    }
  }
  return lista;
}

export type ReceitaCustoLucroMes = {
  ano: number;
  mes: number;
  rotulo: string;
  faturado: number;
  custos: number;
  lucro: number;
  // percentual (ex: 23.5 = 23,5%). null = sem faturamento no mês.
  margemPercent: number | null;
};

// Seção "Faturamento mês a mês" (tabela com uma linha por mês). Array vai do
// mês mais antigo pro mais recente (ver ultimosMeses acima) — quem exibe
// decide se quer inverter. Independente do filtro de período da tela.
export async function buscarReceitaCustoLucroMensal(
  graficaId: string,
  meses = 12
): Promise<ReceitaCustoLucroMes[]> {
  const agora = new Date();
  const { ano: anoAtual, mes: mesAtual } = anoMesBrasilia(agora);
  const janela = ultimosMeses(anoAtual, mesAtual, meses);
  const inicioJanela = limitesMesBrasilia(janela[0].ano, janela[0].mes).inicio;
  const fimJanela = limitesMesBrasilia(anoAtual, mesAtual).fim;

  const [orcamentos, custosPedido] = await Promise.all([
    prisma.orcamento.findMany({
      where: { graficaId, status: "APROVADO", createdAt: { gte: inicioJanela, lt: fimJanela } },
      select: { createdAt: true, total: true },
    }),
    prisma.custoPedido.findMany({
      where: {
        graficaId,
        createdAt: { gte: inicioJanela, lt: fimJanela },
        // mesma exclusão de custo estornado que buscarRelatorioNegocio faz.
        estornadoEm: null,
      },
      select: { createdAt: true, valor: true },
    }),
  ]);

  const faturadoPorMes = new Map<string, Dec>();
  for (const o of orcamentos) {
    const chave = chaveMes(anoMesBrasilia(o.createdAt));
    faturadoPorMes.set(chave, (faturadoPorMes.get(chave) ?? new D(0)).plus(String(o.total)));
  }
  const custosPorMes = new Map<string, Dec>();
  for (const c of custosPedido) {
    const chave = chaveMes(anoMesBrasilia(c.createdAt));
    custosPorMes.set(chave, (custosPorMes.get(chave) ?? new D(0)).plus(String(c.valor)));
  }

  return janela.map(({ ano, mes }) => {
    const chave = chaveMes({ ano, mes });
    const faturado = faturadoPorMes.get(chave) ?? new D(0);
    const custos = custosPorMes.get(chave) ?? new D(0);
    const lucro = faturado.minus(custos);
    return {
      ano,
      mes,
      rotulo: rotuloMesCurto(ano, mes),
      faturado: faturado.toNumber(),
      custos: custos.toNumber(),
      lucro: lucro.toNumber(),
      margemPercent: faturado.gt(0) ? lucro.div(faturado).times(100).toNumber() : null,
    };
  });
}

export type MesColuna = { ano: number; mes: number; rotulo: string };
export type ClienteReceitaPorMes = {
  clienteId: string;
  clienteNome: string;
  // chave "AAAA-MM" (ver chaveMes) -> faturado daquele cliente naquele mês.
  porMes: Record<string, number>;
  total: number;
};
export type ReceitaPorClienteEMes = {
  meses: MesColuna[];
  clientes: ClienteReceitaPorMes[];
};

// Seção "Faturamento por cliente × mês" (matriz pivot). Top N clientes por
// faturamento total na janela (TOP_CLIENTES_MATRIZ), resto agregado numa
// linha "Outros" — igual ao padrão de "Outros (N)" já usado em
// custosPorCategoria na tela de relatórios. Independente do filtro de
// período da tela.
export async function buscarReceitaPorClienteEMes(
  graficaId: string,
  meses = 12
): Promise<ReceitaPorClienteEMes> {
  const agora = new Date();
  const { ano: anoAtual, mes: mesAtual } = anoMesBrasilia(agora);
  const janela = ultimosMeses(anoAtual, mesAtual, meses);
  const inicioJanela = limitesMesBrasilia(janela[0].ano, janela[0].mes).inicio;
  const fimJanela = limitesMesBrasilia(anoAtual, mesAtual).fim;

  const orcamentos = await prisma.orcamento.findMany({
    where: { graficaId, status: "APROVADO", createdAt: { gte: inicioJanela, lt: fimJanela } },
    select: { clienteId: true, createdAt: true, total: true, cliente: { select: { nome: true } } },
  });

  type Acumulador = { nome: string; porMes: Map<string, Dec>; total: Dec };
  const porCliente = new Map<string, Acumulador>();
  for (const o of orcamentos) {
    const chave = chaveMes(anoMesBrasilia(o.createdAt));
    const atual: Acumulador = porCliente.get(o.clienteId) ?? {
      nome: o.cliente.nome,
      porMes: new Map<string, Dec>(),
      total: new D(0),
    };
    atual.porMes.set(chave, (atual.porMes.get(chave) ?? new D(0)).plus(String(o.total)));
    atual.total = atual.total.plus(String(o.total));
    porCliente.set(o.clienteId, atual);
  }

  const ordenados = [...porCliente.entries()].sort((a, b) => b[1].total.comparedTo(a[1].total));

  const paraLinha = (id: string, acc: Acumulador): ClienteReceitaPorMes => {
    const porMes: Record<string, number> = {};
    for (const { ano, mes } of janela) {
      const chave = chaveMes({ ano, mes });
      porMes[chave] = (acc.porMes.get(chave) ?? new D(0)).toNumber();
    }
    return { clienteId: id, clienteNome: acc.nome, porMes, total: acc.total.toNumber() };
  };

  const topClientes = ordenados.slice(0, TOP_CLIENTES_MATRIZ).map(([id, acc]) => paraLinha(id, acc));
  const restante = ordenados.slice(TOP_CLIENTES_MATRIZ);

  const clientes =
    restante.length === 0
      ? topClientes
      : [
          ...topClientes,
          (() => {
            const porMesOutros = new Map<string, Dec>();
            let totalOutros = new D(0);
            for (const [, acc] of restante) {
              totalOutros = totalOutros.plus(acc.total);
              for (const [chave, valor] of acc.porMes.entries()) {
                porMesOutros.set(chave, (porMesOutros.get(chave) ?? new D(0)).plus(valor));
              }
            }
            return paraLinha("outros", {
              nome: `Outros (${restante.length})`,
              porMes: porMesOutros,
              total: totalOutros,
            });
          })(),
        ];

  return {
    meses: janela.map(({ ano, mes }) => ({ ano, mes, rotulo: rotuloMesCurto(ano, mes) })),
    clientes,
  };
}
