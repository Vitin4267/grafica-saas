/**
 * DRE (Demonstrativo de Resultado) simplificado — função PURA (sem acesso a
 * banco, sem I/O). Recebe agregados já calculados pelo chamador (ver
 * src/lib/dre-query.ts, que faz as somas via Prisma) e monta as linhas do
 * relatório, mesmo padrão de separação já usado em fluxo-caixa.ts/
 * fluxo-caixa-query.ts (achado A4 da mesma auditoria).
 *
 * Achado A3 da Parte 4 da auditoria de abrangência
 * (pesquisa-abrangencia-modulos.md, 2026-09-05): não existia DRE nenhum, e o
 * "saldo real" do Meu Negócio misturava regime de CAIXA (despesa paga) com
 * regime de COMPETÊNCIA (orçamento aprovado, não necessariamente recebido)
 * na mesma subtração, sem avisar — ver a correção em src/lib/meu-negocio.ts.
 *
 * Por isso toda linha aqui carrega um `regime` EXPLÍCITO:
 * - "COMPETENCIA": reconhecido no período mesmo sem o caixa ter se
 *   movimentado ainda (Orcamento aprovado, CustoPedido lançado na produção
 *   — que pode nem ter sido pago ainda, ex.: CONSUMO_ESTOQUE).
 * - "CAIXA": dinheiro que já entrou/saiu de verdade (Despesa PAGA, Comissao
 *   PAGA).
 * - "MISTO": subtotal que soma/subtrai linhas de regimes diferentes de
 *   propósito (a pergunta "minha margem de contribuição por competência
 *   cobriu meu custo fixo que eu de fato PAGUEI este mês" é uma pergunta
 *   gerencial legítima) — a diferença pro bug do saldoReal é que aqui a
 *   mistura é ROTULADA, nunca escondida atrás de um nome que sugere "só
 *   caixa" ou "só competência".
 *
 * Estrutura consensual de DRE simplificado pra gráfica (ver pesquisa no
 * achado A3): Receita Bruta → (−) impostos/descontos → Receita Líquida →
 * (−) custos variáveis → Margem de Contribuição (%) → (−) custo fixo −
 * comissões → Resultado Operacional → (−) despesas financeiras →
 * Resultado Líquido, fechando com Ponto de Equilíbrio = Custo Fixo ÷ %MC.
 */

export type RegimeDRE = "CAIXA" | "COMPETENCIA" | "MISTO";

export interface LinhaDRE {
  rotulo: string;
  valor: number;
  regime: RegimeDRE;
  /** Só preenchido em linhas MISTO — explica de onde vem cada parte da mistura. */
  detalheRegime?: string;
}

/**
 * Agregados de entrada — TODOS já somados pelo chamador (dre-query.ts) pro
 * período escolhido. Nenhum campo aqui é lido de um model do Prisma
 * diretamente; são só números.
 */
export interface EntradaDRE {
  /** COMPETENCIA — soma de Orcamento.total aprovado no período. */
  receitaBruta: number;
  /**
   * COMPETENCIA — estimativa de impostos sobre a receita bruta do período
   * (ParametrosGrafica.impostoPercent × receitaBruta). É ESTIMATIVA, não
   * apuração real de tributo — mesma ressalva já registrada no achado A10
   * da mesma auditoria (impostoPercent não conhece regime tributário nem
   * RBT12 acumulado).
   */
  impostos: number;
  /** COMPETENCIA — desconto concedido nos itens dos orçamentos aprovados do período. */
  descontos: number;
  /** COMPETENCIA — soma de CustoPedido.valor (não estornado) cuja CategoriaCusto.natureza = VARIAVEL. */
  custosVariaveis: number;
  /** CAIXA — soma de Despesa.valor PAGA no período cuja CategoriaCusto.natureza = FIXO. */
  custoFixo: number;
  /** CAIXA — soma de Comissao.valorComissao com status PAGA, pagoEm no período. */
  comissoes: number;
  /**
   * CAIXA — despesas financeiras pagas no período (juros, tarifa bancária,
   * taxa de maquininha). Hoje sempre 0: o sistema ainda não tem uma
   * classificação própria de "despesa financeira" nem apura taxa real de
   * recebimento (ver achados A5 e A11 da mesma auditoria — nenhum dos dois
   * construído). Campo existe pra manter a estrutura do DRE completa, pronto
   * pra ganhar dado real sem mudar a forma do relatório.
   */
  despesasFinanceiras: number;
}

export interface ResultadoDRE {
  linhas: LinhaDRE[];
  receitaLiquida: number;
  margemContribuicao: number;
  /** null quando receitaLiquida = 0 (percentual indefinido, evita divisão por zero). */
  margemContribuicaoPercent: number | null;
  resultadoOperacional: number;
  resultadoLiquido: number;
  /**
   * Custo Fixo ÷ %MC — receita bruta necessária pra empatar. null quando a
   * margem de contribuição é indefinida (receitaLiquida = 0) ou não-positiva
   * (custo variável consome toda a receita líquida ou mais — nesse caso não
   * existe patamar de receita que feche a conta, aumentar receita sozinho
   * não resolve).
   */
  pontoEquilibrio: number | null;
}

const DETALHE_RESULTADO_OPERACIONAL =
  "Margem de contribuição por COMPETÊNCIA (receita aprovada − custo variável lançado) menos custo fixo e comissões por CAIXA (só o que foi de fato pago no período).";

export function montarDRE(entrada: EntradaDRE): ResultadoDRE {
  const {
    receitaBruta,
    impostos,
    descontos,
    custosVariaveis,
    custoFixo,
    comissoes,
    despesasFinanceiras,
  } = entrada;

  const receitaLiquida = receitaBruta - impostos - descontos;
  const margemContribuicao = receitaLiquida - custosVariaveis;
  const margemContribuicaoPercent = receitaLiquida !== 0 ? margemContribuicao / receitaLiquida : null;
  const resultadoOperacional = margemContribuicao - custoFixo - comissoes;
  const resultadoLiquido = resultadoOperacional - despesasFinanceiras;

  // Só existe ponto de equilíbrio quando cada real adicional de receita
  // realmente sobra alguma coisa depois do custo variável (%MC > 0). Com
  // %MC <= 0, nenhum volume de vendas fecha a conta — o problema é de
  // precificação/custo variável, não de volume.
  const pontoEquilibrio =
    margemContribuicaoPercent !== null && margemContribuicaoPercent > 0
      ? custoFixo / margemContribuicaoPercent
      : null;

  const linhas: LinhaDRE[] = [
    { rotulo: "Receita bruta", valor: receitaBruta, regime: "COMPETENCIA" },
    { rotulo: "(−) Impostos (estimado)", valor: -impostos, regime: "COMPETENCIA" },
    { rotulo: "(−) Descontos", valor: -descontos, regime: "COMPETENCIA" },
    { rotulo: "= Receita líquida", valor: receitaLiquida, regime: "COMPETENCIA" },
    { rotulo: "(−) Custos variáveis", valor: -custosVariaveis, regime: "COMPETENCIA" },
    { rotulo: "= Margem de contribuição", valor: margemContribuicao, regime: "COMPETENCIA" },
    { rotulo: "(−) Custo fixo (pago)", valor: -custoFixo, regime: "CAIXA" },
    { rotulo: "(−) Comissões (pagas)", valor: -comissoes, regime: "CAIXA" },
    {
      rotulo: "= Resultado operacional",
      valor: resultadoOperacional,
      regime: "MISTO",
      detalheRegime: DETALHE_RESULTADO_OPERACIONAL,
    },
    { rotulo: "(−) Despesas financeiras (pagas)", valor: -despesasFinanceiras, regime: "CAIXA" },
    {
      rotulo: "= Resultado líquido",
      valor: resultadoLiquido,
      regime: "MISTO",
      detalheRegime: DETALHE_RESULTADO_OPERACIONAL,
    },
  ];

  return {
    linhas,
    receitaLiquida,
    margemContribuicao,
    margemContribuicaoPercent,
    resultadoOperacional,
    resultadoLiquido,
    pontoEquilibrio,
  };
}
