// Puro (sem "server-only", sem Prisma) — testável isolado, mesmo padrão de
// src/lib/dre.ts/src/lib/csv.ts. Achado A16 da Parte 4 da auditoria de
// abrangência (pesquisa-abrangencia-modulos.md, 2026-09-07): a exportação
// financeira pro contador (src/app/financeiro/exportar/route.ts) ganhou
// intervalo livre de datas + blocos novos (contas a receber com aging,
// comissões, custos por pedido, agrupamento por categoria/natureza, DRE do
// período, possíveis duplicidades) — este arquivo concentra a lógica PURA
// desses blocos (sem I/O), pra poder testar sem banco. A busca dos dados no
// Postgres fica em src/lib/exportacao-financeira-query.ts (mesma separação
// query/lógica de dre-query.ts/dre.ts).

import { D, paraDecimal, type Dec } from "@/lib/pricing/decimal";

// ---------------------------------------------------------------------------
// Aging de conta a receber

export type FaixaAging = "EM_DIA" | "1_30" | "31_60" | "61_90" | "90_MAIS";

export const ROTULO_FAIXA_AGING: Record<FaixaAging, string> = {
  EM_DIA: "Em dia",
  "1_30": "1 a 30 dias",
  "31_60": "31 a 60 dias",
  "61_90": "61 a 90 dias",
  "90_MAIS": "Mais de 90 dias",
};

// vencimento é DATA-PURA (meia-noite UTC, ver src/lib/data.ts) — `hoje`
// também precisa chegar como meia-noite UTC (quem chama normaliza, mesmo
// raciocínio de dataEhPassado em src/lib/data.ts) pra não deslocar a
// contagem de dias por causa de hora do dia. diasAtraso <= 0 = ainda não
// venceu (ou vence hoje) → faixa EM_DIA.
export function calcularAging(vencimento: Date, hoje: Date): { diasAtraso: number; faixa: FaixaAging } {
  const diasAtraso = Math.round((hoje.getTime() - vencimento.getTime()) / (24 * 60 * 60 * 1000));
  if (diasAtraso <= 0) return { diasAtraso, faixa: "EM_DIA" };
  if (diasAtraso <= 30) return { diasAtraso, faixa: "1_30" };
  if (diasAtraso <= 60) return { diasAtraso, faixa: "31_60" };
  if (diasAtraso <= 90) return { diasAtraso, faixa: "61_90" };
  return { diasAtraso, faixa: "90_MAIS" };
}

// ---------------------------------------------------------------------------
// Agrupamento de custo por categoria, com subtotal por natureza

export type NaturezaCustoRotulo = "VARIAVEL" | "FIXO" | "SEMIVARIAVEL";

export const ROTULO_NATUREZA: Record<NaturezaCustoRotulo, string> = {
  VARIAVEL: "Variável",
  FIXO: "Fixo",
  SEMIVARIAVEL: "Semivariável",
};

export interface LancamentoCategorizado {
  categoriaId: string;
  categoriaNome: string;
  natureza: NaturezaCustoRotulo;
  valor: Dec | number | string;
}

export interface SubtotalCategoria {
  categoriaId: string;
  categoriaNome: string;
  natureza: NaturezaCustoRotulo;
  total: Dec;
}

export interface SubtotalNatureza {
  natureza: NaturezaCustoRotulo;
  total: Dec;
}

export interface AgrupamentoCategoria {
  categorias: SubtotalCategoria[];
  naturezas: SubtotalNatureza[];
  totalGeral: Dec;
}

// Soma Despesa (paga) + CustoPedido (não estornado) do período, já
// resolvidos pelo chamador com o nome/natureza da CategoriaCusto (ver
// exportacao-financeira-query.ts) — junta os dois num único agrupamento por
// categoria, com subtotal por natureza (VARIAVEL/FIXO/SEMIVARIAVEL, achado
// A2 da mesma auditoria). Ordem determinística: categorias por nome, depois
// naturezas na ordem fixa VARIAVEL/FIXO/SEMIVARIAVEL (mesma ordem do enum).
export function agruparPorCategoriaComNatureza(lancamentos: LancamentoCategorizado[]): AgrupamentoCategoria {
  const porCategoria = new Map<string, SubtotalCategoria>();
  for (const l of lancamentos) {
    const existente = porCategoria.get(l.categoriaId);
    const valor = paraDecimal(String(l.valor));
    if (existente) {
      existente.total = existente.total.plus(valor);
    } else {
      porCategoria.set(l.categoriaId, {
        categoriaId: l.categoriaId,
        categoriaNome: l.categoriaNome,
        natureza: l.natureza,
        total: valor,
      });
    }
  }

  const categorias = [...porCategoria.values()].sort((a, b) =>
    a.categoriaNome.localeCompare(b.categoriaNome, "pt-BR")
  );

  const ORDEM_NATUREZA: NaturezaCustoRotulo[] = ["VARIAVEL", "FIXO", "SEMIVARIAVEL"];
  const naturezas: SubtotalNatureza[] = ORDEM_NATUREZA.filter((natureza) =>
    categorias.some((c) => c.natureza === natureza)
  ).map((natureza) => ({
    natureza,
    total: categorias.filter((c) => c.natureza === natureza).reduce((soma, c) => soma.plus(c.total), new D(0)),
  }));

  const totalGeral = categorias.reduce((soma, c) => soma.plus(c.total), new D(0));

  return { categorias, naturezas, totalGeral };
}

// ---------------------------------------------------------------------------
// Candidatos a possível duplicidade de recebimento (achado A16)
//
// Mecanismo real (ver comentário em Pagamento.contaReceber no schema e em
// registrarBaixaContaReceber, src/app/financeiro/contas-receber/actions.ts):
// registrarPagamento (tela do orçamento) só reconcilia automaticamente com
// uma ContaReceber PENDENTE quando o valor bate EXATO — fora desse caso, um
// Pagamento manual fica solto. Se depois alguém também clicar "Marcar como
// recebido"/registrar baixa na tela de Contas a Receber pro MESMO dinheiro,
// nasce um SEGUNDO Pagamento pro mesmo orçamento — sem deduplicação
// automática entre os dois caminhos (risco aceito, documentado no schema).
//
// Heurística (não é certeza, é candidato pra revisão humana): some todos os
// Pagamento de um mesmo orçamento no período; se a soma ULTRAPASSAR o total
// do orçamento, é sinal de possível dupla contagem — EXCETO a parte que
// financiou um depósito de CreditoCliente (cliente pagando a mais de
// propósito, mecanismo legítimo de sobra virando saldo — ver
// MovimentacaoCreditoCliente.pagamentoId), que o chamador já exclui da soma
// antes de chegar aqui (ver financiaCreditoCliente no tipo de entrada).
export interface PagamentoParaDuplicidade {
  pagamentoId: string;
  orcamentoId: string;
  orcamentoTotal: Dec | number | string;
  clienteNome: string;
  valor: Dec | number | string;
  /** true = este pagamento financiou um depósito de CreditoCliente — excluído da soma. */
  financiaCreditoCliente: boolean;
}

export interface CandidatoDuplicidade {
  orcamentoId: string;
  clienteNome: string;
  totalOrcamento: Dec;
  totalPago: Dec;
  diferenca: Dec;
  quantidadePagamentos: number;
}

export function detectarCandidatosDuplicidade(pagamentos: PagamentoParaDuplicidade[]): CandidatoDuplicidade[] {
  const porOrcamento = new Map<
    string,
    { clienteNome: string; totalOrcamento: Dec; totalPago: Dec; quantidade: number }
  >();

  for (const p of pagamentos) {
    if (p.financiaCreditoCliente) continue;
    const existente = porOrcamento.get(p.orcamentoId);
    const valor = paraDecimal(String(p.valor));
    if (existente) {
      existente.totalPago = existente.totalPago.plus(valor);
      existente.quantidade += 1;
    } else {
      porOrcamento.set(p.orcamentoId, {
        clienteNome: p.clienteNome,
        totalOrcamento: paraDecimal(String(p.orcamentoTotal)),
        totalPago: valor,
        quantidade: 1,
      });
    }
  }

  const candidatos: CandidatoDuplicidade[] = [];
  for (const [orcamentoId, dados] of porOrcamento) {
    if (dados.quantidade < 2) continue; // 1 pagamento só nunca é candidato
    if (dados.totalPago.gt(dados.totalOrcamento)) {
      candidatos.push({
        orcamentoId,
        clienteNome: dados.clienteNome,
        totalOrcamento: dados.totalOrcamento,
        totalPago: dados.totalPago,
        diferenca: dados.totalPago.minus(dados.totalOrcamento),
        quantidadePagamentos: dados.quantidade,
      });
    }
  }

  // Maior diferença primeiro — o caso mais provável de ser duplicidade de
  // verdade (em vez de arredondamento) aparece no topo.
  return candidatos.sort((a, b) => b.diferenca.minus(a.diferenca).toNumber());
}
