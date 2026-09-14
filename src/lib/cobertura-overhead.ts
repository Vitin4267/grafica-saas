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
   * Achado N20 da Parte 9 da auditoria de código (2026-09-12) — soma, em
   * R$, de `OrcamentoItem.breakdown.custoDireto` (valor ABSOLUTO por item,
   * `custoBase + acabamentos + embalagem + frete`, ANTES do overhead — ver
   * `ResultadoComposicao.custoDireto` em src/lib/pricing/compor.ts) de todos
   * os itens de orçamentos APROVADOS no período. Esta é a base REAL sobre a
   * qual `ParametrosGrafica.overheadPercent` incide (`compor.ts:56`:
   * `overhead = custoDireto × overheadPercent`) — o campo antigo
   * `receitaBruta` (soma de `Orcamento.total`) NUNCA foi a base certa pra
   * "que percentual fecharia a conta": receita inclui margem/imposto/
   * comissão além do custo direto, então dividir custoFixoPago por receita
   * sempre subestimava o percentual necessário (erro sistemático PRA BAIXO,
   * empurrando a gráfica a configurar overhead insuficiente).
   */
  custoDiretoAgregado: number;
  /**
   * Achado N30 da Parte 9 da auditoria de código (2026-09-12) — soma, em
   * R$, de `OrcamentoItem.precoTotal` de TODOS os itens de orçamentos
   * APROVADOS no período (SIMPLES incluído), pra medir quanto da receita
   * do período este relatório de fato enxerga.
   */
  receitaTotalAprovada: number;
  /**
   * Achado N30 — fatia de `receitaTotalAprovada` que veio de item SEM
   * `custoDireto` rastreado (item SIMPLES, na prática) — nunca entra em
   * `overheadCobrado` nem em `custoDiretoAgregado`. Uma gráfica que vende
   * majoritariamente por SIMPLES tem essa fatia próxima de 100%: o
   * relatório mede a cobertura de um mecanismo (overhead embutido no motor
   * avançado) que ela mal usa, e sem este campo a tela não tinha como
   * avisar — "overhead cobriu R$0,00, custo fixo real R$28.000" parecia
   * alarme de verdade quando era só escopo.
   */
  receitaSemCustoDireto: number;
}

export interface ResultadoCoberturaOverhead {
  /** Quanto overhead foi efetivamente cobrado nos orçamentos aprovados do período. */
  overheadCobrado: number;
  /** Quanto de custo fixo real foi pago no mesmo período. */
  custoFixoPago: number;
  /**
   * Que percentual de overhead (sobre o CUSTO DIRETO agregado do período,
   * a mesma base que `compor.ts` usa de verdade — ver comentário de
   * `custoDiretoAgregado` acima) seria necessário pra cobrir exatamente o
   * custo fixo pago — ou seja, "que ParametrosGrafica.overheadPercent
   * fecharia a conta". `null` quando custoDiretoAgregado = 0 (nenhum
   * orçamento com custo direto rastreado no período — percentual
   * indefinido, evita divisão por zero).
   */
  percentualQueFecharia: number | null;
  /**
   * custoFixoPago − overheadCobrado. Positivo = o overhead cobrado NÃO
   * cobriu o custo fixo real (a gráfica está subsidiando o fixo com
   * margem). Negativo = o overhead cobrado sobrou em relação ao custo
   * fixo real do período.
   */
  diferenca: number;
  /**
   * Achado N30 — 0-100, que fração de `receitaTotalAprovada` NÃO tem
   * custoDireto rastreado (item SIMPLES). `null` quando não houve receita
   * aprovada no período nenhuma (nada a medir). A tela usa isto pra
   * avisar quando o relatório está vendo só uma fatia pequena da operação
   * real da gráfica, em vez de deixar o número parecer completo.
   */
  percentualReceitaForaDoEscopo: number | null;
}

export function calcularCoberturaOverhead(
  entrada: EntradaCoberturaOverhead
): ResultadoCoberturaOverhead {
  const { overheadCobrado, custoFixoPago, custoDiretoAgregado, receitaTotalAprovada, receitaSemCustoDireto } =
    entrada;

  // Achado N20 — base é custoDiretoAgregado, NUNCA receita bruta (ver
  // comentário completo em EntradaCoberturaOverhead.custoDiretoAgregado).
  const percentualQueFecharia = custoDiretoAgregado > 0 ? (custoFixoPago / custoDiretoAgregado) * 100 : null;
  const diferenca = custoFixoPago - overheadCobrado;
  // Achado N30 — ver comentário completo de percentualReceitaForaDoEscopo.
  const percentualReceitaForaDoEscopo =
    receitaTotalAprovada > 0 ? (receitaSemCustoDireto / receitaTotalAprovada) * 100 : null;

  return {
    overheadCobrado,
    custoFixoPago,
    percentualQueFecharia,
    diferenca,
    percentualReceitaForaDoEscopo,
  };
}
