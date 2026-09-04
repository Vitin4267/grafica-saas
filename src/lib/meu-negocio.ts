import "server-only";

import { prisma } from "@/lib/prisma";
import { ROTULOS_STATUS_ORCAMENTO, type StatusOrcamento } from "@/lib/orcamento-status";
import { resolverEtapasGrafica } from "@/lib/etapa-grafica";
import { calcularPrevisaoEstoque } from "@/lib/previsao-estoque-db";
import { LIMITE_DIAS_ALERTA } from "@/lib/previsao-estoque";
import { D } from "@/lib/pricing/decimal";
import { inicioMesAtualBrasilia, inicioMesAtualLiteralBrasilia } from "@/lib/data";
import {
  calcularTaxaConversao,
  calcularTempoMedioAprovacaoDias,
  type TaxaConversaoOrcamentos,
} from "@/lib/funil-conversao";

const SEMANAS_SERIE_FATURAMENTO = 8;
const MS_POR_SEMANA = 1000 * 60 * 60 * 24 * 7;

// Bucket por "semana desde o início da série" (janela deslizante de 7 dias,
// não alinhada ao calendário) — simples o bastante pra não precisar de SQL
// bruto (groupBy do Prisma não bucketiza por data). Soma em Decimal, não
// Number() += , mesma disciplina do resto do financeiro (ver
// src/app/financeiro/exportar/route.ts).
function bucketarFaturamentoPorSemana(
  registros: { createdAt: Date; total: unknown }[],
  inicioSerie: Date
): { rotulo: string; total: number }[] {
  const buckets = Array.from({ length: SEMANAS_SERIE_FATURAMENTO }, () => new D(0));
  for (const r of registros) {
    const diasDesdeInicio = (r.createdAt.getTime() - inicioSerie.getTime()) / (1000 * 60 * 60 * 24);
    const indice = Math.min(
      SEMANAS_SERIE_FATURAMENTO - 1,
      Math.max(0, Math.floor(diasDesdeInicio / 7))
    );
    buckets[indice] = buckets[indice].plus(String(r.total));
  }
  return buckets.map((total, i) => ({
    rotulo: `Semana ${i + 1}`,
    total: total.toNumber(),
  }));
}

const ORDEM_STATUS_ORCAMENTO: StatusOrcamento[] = [
  "RASCUNHO",
  "ENVIADO",
  "APROVADO",
  "REJEITADO",
];

export type FaixaStatus = { status: string; rotulo: string; quantidade: number };

export type VisaoGeralNegocio = {
  faturamentoMes: { total: number; quantidadeAprovados: number };
  funilOrcamentos: FaixaStatus[];
  totalOrcamentos: number;
  // Sobre TODOS os orçamentos da gráfica, mesmo escopo (sem filtro de mês)
  // que funilOrcamentos/totalOrcamentos acima — ver calcularTaxaConversao.
  taxaConversaoOrcamentos: TaxaConversaoOrcamentos;
  // Em dias, só considerando orçamentos aprovados pelo link público (ver
  // calcularTempoMedioAprovacaoDias); null sem nenhum dado disponível.
  tempoMedioAprovacaoDias: number | null;
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
  // Últimas 8 semanas de faturamento aprovado — alimenta o sparkline do
  // hero StatTile em /meu-negocio (D1 do plano de UI/UX). Sempre 8 pontos,
  // mesmo com semana vazia (fica 0), pra não distorcer a leitura visual da
  // tendência.
  serieFaturamentoSemanal: { rotulo: string; total: number }[];
  // Indicador de que a gráfica tem uso real de produção (qualquer Pedido
  // criado). Usado pra esconder cards e links de produção de gráficas de
  // revenda pura (E1 e E2 da auditoria de abrangência).
  temAlgumPedido: boolean;
};

export async function buscarVisaoGeralNegocio(graficaId: string): Promise<VisaoGeralNegocio> {
  const agora = new Date();
  // Fronteira de mês pra colunas de INSTANTE REAL (Orcamento.createdAt,
  // Despesa.pagoEm) — calculada no calendário de Brasília, não no fuso do
  // processo (ver src/lib/data.ts). `agora.getFullYear()/getMonth()` puro
  // seria UTC na Vercel e faria um orçamento aprovado às 22h do último dia
  // do mês (ainda dentro do mês em Brasília) sumir do "faturamento do mês".
  const inicioDoMesReal = inicioMesAtualBrasilia(agora);
  // Fronteira de mês pra Despesa.vencimento — essa é DATA-PURA (meia-noite
  // UTC representando o dia digitado, ver formatoData em src/lib/data.ts),
  // então NÃO pode usar a fronteira acima (ela tem +3h de offset, que
  // deslocaria a comparação contra um campo literal). Mas o MÊS em si é
  // decidido pelo calendário de Brasília, não pelo relógio do processo —
  // senão nas ~3h finais de cada dia a Vercel (UTC) já teria virado o mês e
  // as despesas a vencer do mês corrente sumiriam da tela.
  const inicioDoMesVencimento = inicioMesAtualLiteralBrasilia(agora);
  const inicioSerieFaturamento = new Date(
    agora.getTime() - SEMANAS_SERIE_FATURAMENTO * MS_POR_SEMANA
  );

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
    orcamentosParaSerie,
    orcamentosAprovadosParaTempoResposta,
    etapas,
    primeiroPedido,
  ] = await Promise.all([
    prisma.orcamento.aggregate({
      // NOT pedido.status=CANCELADO — achado N2 da auditoria de abrangência
      // (2026-09-04): cancelarPedido (producao/actions.ts) não reverte
      // Orcamento.status de propósito (menos invasivo — ver comentário lá),
      // então essa exclusão é o que impede um pedido cancelado de continuar
      // contando como faturamento. Pedido sempre existe pra todo orçamento
      // aprovado (criado atomicamente na mesma transação da aprovação, ver
      // atualizarStatusOrcamento em orcamento/[id]/actions.ts) — mas o filtro
      // é escrito como NOT em vez de assumir isso, então não exclui por
      // engano um orçamento aprovado sem Pedido (dado legado/importação).
      where: {
        graficaId,
        status: "APROVADO",
        createdAt: { gte: inicioDoMesReal },
        NOT: { pedido: { status: "CANCELADO" } },
      },
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
      // Mesma exclusão de pedido cancelado do faturamentoAgregado acima —
      // achado N2: sem isso um cliente cujo pedido foi cancelado podia
      // aparecer como "top cliente" por um valor que não foi de fato
      // faturado.
      where: { graficaId, status: "APROVADO", NOT: { pedido: { status: "CANCELADO" } } },
      _sum: { total: true },
      orderBy: { _sum: { total: "desc" } },
      take: 5,
    }),
    prisma.cliente.count({ where: { graficaId } }),
    prisma.itemGrafica.count({ where: { graficaId, ativo: true } }),
    prisma.orcamento.count({ where: { graficaId, createdAt: { gte: inicioDoMesReal } } }),
    prisma.despesa.aggregate({
      // PARCIAL incluído desde o achado A8 da Parte 4 (2026-08-29) — sem
      // isso, uma despesa parcialmente paga sumia inteira desta soma (nem
      // pendente nem paga), subestimando o que ainda falta pagar no mês.
      // Soma o valor CHEIO (não o saldo restante) — mesma simplificação já
      // existente aqui pra PENDENTE, não recalculada por conta desta mudança.
      where: { graficaId, status: { in: ["PENDENTE", "PARCIAL"] }, vencimento: { gte: inicioDoMesVencimento } },
      _sum: { valor: true },
      _count: true,
    }),
    prisma.despesa.aggregate({
      where: { graficaId, status: "PAGA", pagoEm: { gte: inicioDoMesReal } },
      _sum: { valor: true },
    }),
    prisma.orcamento.findMany({
      // Mesma exclusão de pedido cancelado — achado N2: o sparkline de
      // faturamento semanal não pode continuar contando um pedido cancelado.
      where: {
        graficaId,
        status: "APROVADO",
        createdAt: { gte: inicioSerieFaturamento },
        NOT: { pedido: { status: "CANCELADO" } },
      },
      select: { createdAt: true, total: true },
    }),
    // Sem filtro de mês, de propósito — mesmo escopo (todo o histórico) de
    // funilBruto acima, pra taxa de conversão e tempo médio não ficarem
    // desalinhados do funil que a tela já mostra.
    prisma.orcamento.findMany({
      where: { graficaId, status: "APROVADO" },
      select: { createdAt: true, respostaPublicaEm: true },
    }),
    // Achado A1 (Fase 1) — sequência/rótulos por gráfica (liga/desliga e
    // renomeia etapa, ver EtapaGrafica), não mais os arrays literais fixos.
    resolverEtapasGrafica(graficaId),
    // Achados E1 e E2 (Parte 7, Completude de cadastro) — verifica se a
    // gráfica tem uso real de produção (qualquer Pedido criado). Usa findFirst
    // com select { id: true } e take: 1 pra query barata (só precisa saber se
    // existe, não precisa dos dados).
    prisma.pedido.findFirst({
      where: { graficaId },
      select: { id: true },
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
  const taxaConversaoOrcamentos = calcularTaxaConversao(funilOrcamentos);
  const tempoMedioAprovacaoDias = calcularTempoMedioAprovacaoDias(
    orcamentosAprovadosParaTempoResposta
  );

  const contagemPorStatusPedido = new Map(pipelineBruto.map((g) => [g.status, g._count]));
  const pipelineProducao = etapas.sequencia.map((status) => ({
    status,
    rotulo: etapas.rotulos[status],
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
    taxaConversaoOrcamentos,
    tempoMedioAprovacaoDias,
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
    serieFaturamentoSemanal: bucketarFaturamentoPorSemana(
      orcamentosParaSerie,
      inicioSerieFaturamento
    ),
    temAlgumPedido: primeiroPedido !== null,
  };
}
