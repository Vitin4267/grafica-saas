import "server-only";

import { prisma } from "@/lib/prisma";
import { D, paraDecimal, type Dec } from "@/lib/pricing/decimal";
import { buscarDRE } from "@/lib/dre-query";
import type { ResultadoDRE } from "@/lib/dre";
import {
  calcularAging,
  agruparPorCategoriaComNatureza,
  detectarCandidatosDuplicidade,
  type FaixaAging,
  type NaturezaCustoRotulo,
  type AgrupamentoCategoria,
  type CandidatoDuplicidade,
} from "@/lib/exportacao-financeira";
import { saldoContaReceber } from "@/lib/baixa-financeira";

/**
 * Camada de consulta da exportação financeira pro contador (achado A16 da
 * Parte 4 da auditoria de abrangência, 2026-09-07) — busca tudo no Postgres
 * e entrega já agregado pro chamador (src/app/financeiro/exportar/route.ts)
 * só formatar em CSV. Mesma separação query/lógica pura de dre-query.ts/
 * dre.ts. NENHUMA regra de negócio nova mora aqui além da orquestração das
 * buscas — a lógica dos blocos novos (aging, agrupamento por categoria,
 * candidatos a duplicidade) está em src/lib/exportacao-financeira.ts, pura e
 * testável sem banco.
 */

export interface PeriodoExportacao {
  /** Instante real (Brasília) — filtra createdAt/pagoEm (Pagamento, Despesa.pagoEm, Comissao, CustoPedido). */
  inicioReal: Date;
  fimReal: Date;
  /** Data-pura UTC — filtra vencimento (Despesa, ContaReceber). */
  inicioLiteral: Date;
  fimLiteral: Date;
}

export interface LinhaPagamento {
  id: string;
  data: Date;
  clienteNome: string;
  filialNome: string | null;
  forma: string;
  formaDetalhe: string | null;
  valor: Dec;
}

export interface LinhaDespesa {
  id: string;
  data: Date | null;
  descricao: string;
  categoria: string | null;
  filialNome: string | null;
  valor: Dec;
}

export interface LinhaContaReceber {
  id: string;
  descricao: string;
  clienteNome: string;
  filialNome: string | null;
  vencimento: Date;
  valor: Dec;
  saldo: Dec;
  status: string;
  diasAtraso: number;
  faixaAging: FaixaAging;
}

export interface LinhaComissao {
  id: string;
  vendedorNome: string;
  clienteNome: string;
  filialNome: string | null;
  valorComissao: Dec;
  status: string;
  pagoEm: Date | null;
  createdAt: Date;
}

export interface LinhaCustoPorPedido {
  pedidoId: string;
  clienteNome: string;
  filialNome: string | null;
  total: Dec;
  quantidadeLancamentos: number;
}

export interface DadosExportacaoFinanceira {
  pagamentos: LinhaPagamento[];
  despesasPagas: LinhaDespesa[];
  despesasPendentes: LinhaDespesa[];
  contasAReceber: LinhaContaReceber[];
  comissoes: LinhaComissao[];
  custosPorPedido: LinhaCustoPorPedido[];
  agrupamentoCategoria: AgrupamentoCategoria;
  candidatosDuplicidade: CandidatoDuplicidade[];
  dre: ResultadoDRE;
  totais: {
    receitas: Dec;
    despesasPagas: Dec;
    despesasPendentes: Dec;
    contasAReceberAbertas: Dec;
    comissoesPagas: Dec;
    custosPedido: Dec;
  };
}

// hoje em meia-noite UTC — usado só pra calcular aging (dias de atraso),
// sempre relativo a HOJE de verdade, mesmo quando o período exportado é
// passado (aging responde "quanto isso está atrasado agora", não "quanto
// estava atrasado no fim do período"). Mesmo raciocínio de dataEhPassado em
// src/lib/data.ts.
function hojeLiteralUTC(): Date {
  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  return hoje;
}

export async function buscarDadosExportacaoFinanceira(
  graficaId: string,
  periodo: PeriodoExportacao
): Promise<DadosExportacaoFinanceira> {
  const { inicioReal, fimReal, inicioLiteral, fimLiteral } = periodo;

  const [
    pagamentosBrutos,
    despesasPagasBrutas,
    despesasPendentesBrutas,
    contasAReceberBrutas,
    comissoesBrutas,
    custosPedidoBrutos,
    dre,
  ] = await Promise.all([
    prisma.pagamento.findMany({
      where: {
        orcamento: { graficaId },
        createdAt: { gte: inicioReal, lt: fimReal },
      },
      include: {
        orcamento: { select: { total: true, cliente: { select: { nome: true } }, filial: { select: { nome: true } } } },
        movimentacaoCreditoCliente: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.despesa.findMany({
      where: { graficaId, status: "PAGA", pagoEm: { gte: inicioReal, lt: fimReal } },
      include: {
        filial: { select: { nome: true } },
        categoriaCusto: { select: { id: true, nome: true, natureza: true } },
      },
      orderBy: { pagoEm: "asc" },
    }),
    prisma.despesa.findMany({
      where: {
        graficaId,
        status: { in: ["PENDENTE", "PARCIAL"] },
        vencimento: { gte: inicioLiteral, lt: fimLiteral },
      },
      include: { filial: { select: { nome: true } } },
      orderBy: { vencimento: "asc" },
    }),
    // Contas a receber ABERTAS (PENDENTE/PARCIAL) com vencimento até o FIM
    // do período — diferente de despesasPendentes acima (que é uma janela
    // fechada `[inicio, fim)`): um relatório de AGING existe justamente pra
    // mostrar título vencido há muito tempo (antes do período escolhido),
    // não só o que venceu dentro da janela. Sem limite inferior de
    // propósito. `lt: fimLiteral` ainda evita mostrar parcela que só vence
    // DEPOIS do período (isso é "a vencer no futuro", fora do que faz
    // sentido apurar num extrato fechado até uma certa data). EM_COBRANCA
    // (achado A5 da Parte 4, 2026-09-09) entra aqui também — é exatamente no
    // relatório pro contador que "em cobrança" separado de "pendente comum"
    // faz mais diferença (ver comentário em StatusContaReceber no schema).
    prisma.contaReceber.findMany({
      where: {
        graficaId,
        status: { in: ["PENDENTE", "PARCIAL", "EM_COBRANCA"] },
        vencimento: { lt: fimLiteral },
      },
      include: {
        orcamento: { select: { cliente: { select: { nome: true } }, filial: { select: { nome: true } } } },
      },
      orderBy: { vencimento: "asc" },
    }),
    prisma.comissao.findMany({
      where: { graficaId, createdAt: { gte: inicioReal, lt: fimReal } },
      include: {
        usuario: { select: { nome: true } },
        orcamento: { select: { cliente: { select: { nome: true } }, filial: { select: { nome: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.custoPedido.findMany({
      where: { graficaId, createdAt: { gte: inicioReal, lt: fimReal }, estornadoEm: null },
      include: {
        categoriaCusto: { select: { id: true, nome: true, natureza: true } },
        pedido: {
          select: {
            id: true,
            orcamento: { select: { cliente: { select: { nome: true } }, filial: { select: { nome: true } } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    buscarDRE(graficaId, inicioReal, fimReal),
  ]);

  const pagamentos: LinhaPagamento[] = pagamentosBrutos.map((p) => ({
    id: p.id,
    data: p.createdAt,
    clienteNome: p.orcamento.cliente.nome,
    filialNome: p.orcamento.filial?.nome ?? null,
    forma: p.forma,
    formaDetalhe: p.formaDetalhe,
    valor: paraDecimal(p.valor.toString()),
  }));

  const despesasPagas: LinhaDespesa[] = despesasPagasBrutas.map((d) => ({
    id: d.id,
    data: d.pagoEm,
    descricao: d.descricao,
    categoria: d.categoria,
    filialNome: d.filial?.nome ?? null,
    valor: paraDecimal(d.valor.toString()),
  }));

  const despesasPendentes: LinhaDespesa[] = despesasPendentesBrutas.map((d) => ({
    id: d.id,
    data: d.vencimento,
    descricao: d.descricao,
    categoria: d.categoria,
    filialNome: d.filial?.nome ?? null,
    valor: paraDecimal(d.valor.toString()),
  }));

  const hoje = hojeLiteralUTC();
  const contasAReceber: LinhaContaReceber[] = await Promise.all(
    contasAReceberBrutas.map(async (c) => {
      const saldo =
        c.status === "PARCIAL" || c.status === "EM_COBRANCA"
          ? await saldoContaReceber(prisma, c)
          : paraDecimal(c.valor.toString());
      const { diasAtraso, faixa } = calcularAging(c.vencimento, hoje);
      return {
        id: c.id,
        descricao: c.descricao,
        clienteNome: c.orcamento.cliente.nome,
        filialNome: c.orcamento.filial?.nome ?? null,
        vencimento: c.vencimento,
        valor: paraDecimal(c.valor.toString()),
        saldo,
        status: c.status,
        diasAtraso,
        faixaAging: faixa,
      };
    })
  );

  const comissoes: LinhaComissao[] = comissoesBrutas.map((c) => ({
    id: c.id,
    // Achado A12 da Parte 4 — vendedor sem cadastro (ver Comissao.representanteNome).
    vendedorNome: c.usuario?.nome ?? c.representanteNome ?? "Vendedor removido",
    clienteNome: c.orcamento.cliente.nome,
    filialNome: c.orcamento.filial?.nome ?? null,
    valorComissao: paraDecimal(c.valorComissao.toString()),
    status: c.status,
    pagoEm: c.pagoEm,
    createdAt: c.createdAt,
  }));

  // Custos por pedido — agrupado por pedido (proposta do achado A16).
  const porPedido = new Map<string, LinhaCustoPorPedido>();
  for (const c of custosPedidoBrutos) {
    const existente = porPedido.get(c.pedidoId);
    const valor = paraDecimal(c.valor.toString());
    if (existente) {
      existente.total = existente.total.plus(valor);
      existente.quantidadeLancamentos += 1;
    } else {
      porPedido.set(c.pedidoId, {
        pedidoId: c.pedidoId,
        clienteNome: c.pedido.orcamento.cliente.nome,
        filialNome: c.pedido.orcamento.filial?.nome ?? null,
        total: valor,
        quantidadeLancamentos: 1,
      });
    }
  }
  const custosPorPedido = [...porPedido.values()].sort((a, b) => b.total.minus(a.total).toNumber());

  // Agrupamento por categoria com subtotal por natureza (achado A2/A16) —
  // combina Despesa PAGA (categoria estruturada) + CustoPedido do período.
  // Despesa/CustoPedido sem categoriaCustoId estruturado (só texto livre)
  // ficam de fora deste bloco estruturado — mesmo raciocínio de
  // relatorios-negocio.ts (custosPorCategoria só soma o que tem
  // categoriaCustoId, ver src/lib/relatorios-negocio.ts).
  const lancamentosCategorizados = [
    ...despesasPagasBrutas
      .filter((d) => d.categoriaCusto)
      .map((d) => ({
        categoriaId: d.categoriaCusto!.id,
        categoriaNome: d.categoriaCusto!.nome,
        natureza: d.categoriaCusto!.natureza as NaturezaCustoRotulo,
        valor: d.valor.toString(),
      })),
    ...custosPedidoBrutos.map((c) => ({
      categoriaId: c.categoriaCusto.id,
      categoriaNome: c.categoriaCusto.nome,
      natureza: c.categoriaCusto.natureza as NaturezaCustoRotulo,
      valor: c.valor.toString(),
    })),
  ];
  const agrupamentoCategoria = agruparPorCategoriaComNatureza(lancamentosCategorizados);

  // Candidatos a possível duplicidade (achado A16) — ver comentário completo
  // em src/lib/exportacao-financeira.ts.
  const candidatosDuplicidade = detectarCandidatosDuplicidade(
    pagamentosBrutos.map((p) => ({
      pagamentoId: p.id,
      orcamentoId: p.orcamentoId,
      orcamentoTotal: p.orcamento.total.toString(),
      clienteNome: p.orcamento.cliente.nome,
      valor: p.valor.toString(),
      financiaCreditoCliente: p.movimentacaoCreditoCliente !== null,
    }))
  );

  const somar = (valores: Dec[]) => valores.reduce((soma, v) => soma.plus(v), new D(0));

  return {
    pagamentos,
    despesasPagas,
    despesasPendentes,
    contasAReceber,
    comissoes,
    custosPorPedido,
    agrupamentoCategoria,
    candidatosDuplicidade,
    dre,
    totais: {
      receitas: somar(pagamentos.map((p) => p.valor)),
      despesasPagas: somar(despesasPagas.map((d) => d.valor)),
      despesasPendentes: somar(despesasPendentes.map((d) => d.valor)),
      contasAReceberAbertas: somar(contasAReceber.map((c) => c.saldo)),
      comissoesPagas: somar(comissoes.filter((c) => c.status === "PAGA").map((c) => c.valorComissao)),
      custosPedido: somar(custosPorPedido.map((c) => c.total)),
    },
  };
}
