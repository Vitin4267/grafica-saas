/**
 * Cobertura de overhead — função PURA (sem acesso a banco, sem I/O). Recebe
 * agregados já calculados pelo chamador (ver src/lib/cobertura-overhead-db.ts,
 * que busca e soma via Prisma) e devolve a comparação, mesmo padrão de
 * separação já usado em dre.ts/dre-query.ts e fluxo-caixa.ts/
 * fluxo-caixa-query.ts.
 *
 * Achado A2 da Parte 4 da auditoria de abrangência
 * (pesquisa-abrangencia-modulos.md): a proposta original também previa
 * `ParametrosGrafica.overheadModo`, que MUDARIA o motor de preço
 * (`comporPreco` em src/lib/pricing/compor.ts) — isso foi marcado 🔴 Caro e
 * está DELIBERADAMENTE FORA DE ESCOPO aqui. Este arquivo é só RELATÓRIO de
 * leitura: compara quanto overhead foi cobrado nos orçamentos aprovados
 * contra quanto custo fixo de verdade foi pago no mesmo período. Nunca
 * recalcula nem altera preço nenhum — o `overheadPercent` configurado em
 * ParametrosGrafica continua sendo a única fonte de verdade pro que é
 * cobrado no orçamento.
 *
 * Pré-requisito (já construído, não repetir): `CategoriaCusto.natureza`
 * (enum `NaturezaCusto`, desde 2026-09-05) — é o que permite dre-query.ts
 * separar custo FIXO de VARIÁVEL. "Custo fixo pago" aqui é a MESMA query que
 * dre-query.ts já usa (Despesa PAGA no período com categoriaCusto.natureza =
 * FIXO) — ver cobertura-overhead-db.ts.
 */

export interface EntradaCoberturaOverhead {
  /**
   * Soma, em R$, de `OrcamentoItem.breakdown.detalhes.overhead` (valor
   * ABSOLUTO já calculado por item, gravado por src/lib/pricing/compor.ts e
   * serializado em src/lib/orcamento-precificacao.ts) de todos os itens de
   * orçamentos com status APROVADO dentro do período.
   */
  overheadCobrado: number;
  /**
   * CAIXA — soma de `Despesa.valor` PAGA no período cuja
   * `categoriaCusto.natureza` = FIXO. Mesma query/where clause de
   * dre-query.ts (campo `custoFixo` de `EntradaDRE`).
   */
  custoFixoPago: number;
  /**
   * COMPETENCIA — soma de `Orcamento.total` aprovado no período. MESMA base
   * que dre-query.ts usa como `receitaBruta` (o "faturamento" do DRE) — não
   * é uma base nova inventada aqui.
   */
  receitaBruta: number;
}

export interface ResultadoCoberturaOverhead {
  /** Quanto overhead foi efetivamente cobrado nos orçamentos aprovados do período. */
  overheadCobrado: number;
  /** Quanto de custo fixo real foi pago no mesmo período. */
  custoFixoPago: number;
  /**
   * Que percentual de overhead (sobre o faturamento/receita bruta do
   * período) seria necessário pra cobrir exatamente o custo fixo pago —
   * ou seja, "que ParametrosGrafica.overheadPercent fecharia a conta".
   * `null` quando receitaBruta = 0 (nenhum orçamento aprovado no período —
   * percentual indefinido, evita divisão por zero).
   */
  percentualQueFecharia: number | null;
  /**
   * custoFixoPago − overheadCobrado. Positivo = o overhead cobrado NÃO
   * cobriu o custo fixo real (a gráfica está subsidiando o fixo com
   * margem). Negativo = o overhead cobrado sobrou em relação ao custo
   * fixo real do período.
   */
  diferenca: number;
}

export function calcularCoberturaOverhead(
  entrada: EntradaCoberturaOverhead
): ResultadoCoberturaOverhead {
  const { overheadCobrado, custoFixoPago, receitaBruta } = entrada;

  const percentualQueFecharia = receitaBruta > 0 ? (custoFixoPago / receitaBruta) * 100 : null;
  const diferenca = custoFixoPago - overheadCobrado;

  return {
    overheadCobrado,
    custoFixoPago,
    percentualQueFecharia,
    diferenca,
  };
}
