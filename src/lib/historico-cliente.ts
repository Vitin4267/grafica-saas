import "server-only";
import { prisma } from "@/lib/prisma";
import { dataEhPassado, anoMesBrasilia, limitesMesBrasilia } from "@/lib/data";
import { buscarRelatorioNegocio } from "@/lib/relatorios-negocio";
import { saldoContaReceber } from "@/lib/baixa-financeira";

const LIMITE_ORCAMENTOS_RECENTES = 8;
// Mesma janela fixa de 12 meses usada em buscarRankingGeral
// (src/lib/relatorios-negocio.ts) — dá uma visão estável de "faturamento
// recente deste cliente", sem depender de nenhum filtro de tela (a ficha do
// cliente não tem seletor de período).
const MESES_JANELA_FATURAMENTO = 12;

export type OrcamentoRecenteCliente = {
  id: string;
  status: string;
  // "pedido" quando o orçamento já foi promovido (mostra o status de
  // PRODUÇÃO, mais informativo) — null quando ainda não tem Pedido, e o
  // status EXIBIDO cai pro `status` do orçamento acima.
  statusPedido: string | null;
  total: number;
  createdAt: Date;
};

export type ContaEmAbertoCliente = {
  id: string;
  descricao: string;
  valor: number;
  saldo: number;
  vencimento: Date;
  vencida: boolean;
  orcamentoId: string;
};

export type HistoricoCliente = {
  faturamentoPeriodo: {
    faturado: number;
    pedidos: number;
    ticketMedio: number | null;
  };
  orcamentosRecentes: OrcamentoRecenteCliente[];
  contasEmAberto: ContaEmAbertoCliente[];
  totalEmAberto: number;
  totalVencido: number;
};

// Achado A10 da Parte 5 da auditoria de abrangência (2026-08-30) — os três
// blocos que faltavam na ficha do cliente (/clientes/[id]), todos lendo dado
// que já existia: últimos orçamentos/pedidos, faturamento no período (reusa
// buscarRelatorioNegocio em vez de duplicar a agregação) e contas a receber
// em aberto/vencidas. Nada aqui é armazenado — sempre recalculado na leitura
// (mesma disciplina de saldoContaReceber/saldoCreditoCliente).
export async function buscarHistoricoCliente(
  graficaId: string,
  clienteId: string
): Promise<HistoricoCliente> {
  const agora = new Date();
  const { ano: anoAtual, mes: mesAtual } = anoMesBrasilia(agora);
  let anoInicioJanela = anoAtual;
  let mesInicioJanela = mesAtual - (MESES_JANELA_FATURAMENTO - 1);
  while (mesInicioJanela < 1) {
    mesInicioJanela += 12;
    anoInicioJanela -= 1;
  }
  const inicioJanela = limitesMesBrasilia(anoInicioJanela, mesInicioJanela).inicio;

  const [orcamentosRecentesBrutos, contasEmAbertoBrutas, relatorio] = await Promise.all([
    // [graficaId, clienteId] — achado A10, índice novo em Orcamento.
    prisma.orcamento.findMany({
      where: { graficaId, clienteId },
      orderBy: { createdAt: "desc" },
      take: LIMITE_ORCAMENTOS_RECENTES,
      select: {
        id: true,
        status: true,
        total: true,
        createdAt: true,
        pedido: { select: { status: true } },
      },
    }),
    // ContaReceber.clienteId — achado A10, coluna nova.
    prisma.contaReceber.findMany({
      where: { graficaId, clienteId, status: { in: ["PENDENTE", "PARCIAL"] } },
      orderBy: { vencimento: "asc" },
      select: {
        id: true,
        descricao: true,
        valor: true,
        vencimento: true,
        status: true,
        pagamentoId: true,
        orcamentoId: true,
      },
    }),
    buscarRelatorioNegocio({ graficaId, inicio: inicioJanela, fim: agora, clienteId }),
  ]);

  const orcamentosRecentes: OrcamentoRecenteCliente[] = orcamentosRecentesBrutos.map((o) => ({
    id: o.id,
    status: o.status,
    statusPedido: o.pedido?.status ?? null,
    total: Number(o.total),
    createdAt: o.createdAt,
  }));

  // Mesmo padrão de /financeiro/contas-receber: saldo em aberto só precisa
  // ser calculado (via BaixaContaReceber) pras contas PARCIAL — PENDENTE sem
  // baixa nenhuma tem saldo igual ao valor cheio.
  const saldosPorConta = new Map<string, string>();
  await Promise.all(
    contasEmAbertoBrutas
      .filter((c) => c.status === "PARCIAL")
      .map(async (c) => {
        const saldo = await saldoContaReceber(prisma, c);
        saldosPorConta.set(c.id, saldo.toFixed(2));
      })
  );

  const contasEmAberto: ContaEmAbertoCliente[] = contasEmAbertoBrutas.map((c) => {
    const saldo = Number(saldosPorConta.get(c.id) ?? c.valor);
    return {
      id: c.id,
      descricao: c.descricao,
      valor: Number(c.valor),
      saldo,
      vencimento: c.vencimento,
      vencida: dataEhPassado(c.vencimento),
      orcamentoId: c.orcamentoId,
    };
  });

  const totalEmAberto = contasEmAberto.reduce((soma, c) => soma + c.saldo, 0);
  const totalVencido = contasEmAberto
    .filter((c) => c.vencida)
    .reduce((soma, c) => soma + c.saldo, 0);

  return {
    faturamentoPeriodo: {
      faturado: relatorio.metricas.faturado,
      pedidos: relatorio.metricas.pedidos,
      ticketMedio: relatorio.metricas.ticketMedio,
    },
    orcamentosRecentes,
    contasEmAberto,
    totalEmAberto,
    totalVencido,
  };
}
