// Listas curadas de código fiscal usadas nos <Select> dos formulários de
// Dados fiscais (gráfica e filial) — mesmo padrão de src/lib/tipos-equipamento.ts.
// Os campos no banco continuam String simples (não viram enum Prisma): evita
// o problema de enum não poder começar com dígito (CSOSN/CST/PIS-COFINS são
// só números) e a tradução de ida-e-volta que isso geraria. Cada lista vem
// com uma opção "outro" que troca o <Select> pro texto livre no mesmo campo,
// pra nunca travar uma gráfica com um código legítimo fora da lista curada.

export const OPCAO_OUTRO = "outro";

export type OpcaoCodigoFiscal = { valor: string; rotulo: string };

// CSOSN — Código de Situação da Operação no Simples Nacional (Simples
// Nacional apenas). Os mais comuns em operação de gráfica (venda de
// mercadoria própria/de terceiros, tributada ou não pelo Simples).
export const CSOSN_OPCOES: OpcaoCodigoFiscal[] = [
  { valor: "101", rotulo: "101 — Tributada com permissão de crédito" },
  { valor: "102", rotulo: "102 — Tributada sem permissão de crédito" },
  { valor: "103", rotulo: "103 — Isenção do ICMS (faixa de receita bruta)" },
  { valor: "201", rotulo: "201 — Tributada com crédito e cobrança de ICMS ST" },
  { valor: "202", rotulo: "202 — Tributada sem crédito e cobrança de ICMS ST" },
  { valor: "203", rotulo: "203 — Isenção do ICMS com cobrança de ICMS ST" },
  { valor: "300", rotulo: "300 — Imune" },
  { valor: "400", rotulo: "400 — Não tributada pelo Simples Nacional" },
  { valor: "500", rotulo: "500 — ICMS cobrado anteriormente por ST ou antecipação" },
  { valor: "900", rotulo: "900 — Outros" },
];

// CST-ICMS — Código de Situação Tributária (Regime Normal: Lucro Presumido
// ou Lucro Real). Tabela diferente do CSOSN, mesmo os dois começando com
// dígitos parecidos.
export const CST_ICMS_OPCOES: OpcaoCodigoFiscal[] = [
  { valor: "00", rotulo: "00 — Tributada integralmente" },
  { valor: "10", rotulo: "10 — Tributada com cobrança de ICMS ST" },
  { valor: "20", rotulo: "20 — Com redução de base de cálculo" },
  { valor: "30", rotulo: "30 — Isenta/não tributada com cobrança de ICMS ST" },
  { valor: "40", rotulo: "40 — Isenta" },
  { valor: "41", rotulo: "41 — Não tributada" },
  { valor: "50", rotulo: "50 — Suspensão" },
  { valor: "51", rotulo: "51 — Diferimento" },
  { valor: "60", rotulo: "60 — ICMS cobrado anteriormente por ST" },
  { valor: "70", rotulo: "70 — Com redução de base de cálculo e cobrança de ICMS ST" },
  { valor: "90", rotulo: "90 — Outras" },
];

// Modalidade de determinação da base de cálculo do ICMS.
export const ICMS_MODALIDADE_BASE_CALCULO_OPCOES: OpcaoCodigoFiscal[] = [
  { valor: "0", rotulo: "0 — Margem Valor Agregado (%)" },
  { valor: "1", rotulo: "1 — Pauta (valor)" },
  { valor: "2", rotulo: "2 — Preço Tabelado Máx. (valor)" },
  { valor: "3", rotulo: "3 — Valor da operação" },
];

// Situação tributária do PIS e da COFINS — os dois compartilham a mesma
// tabela de código (não é duplicação, é como a SEFAZ define).
export const PIS_COFINS_SITUACAO_TRIBUTARIA_OPCOES: OpcaoCodigoFiscal[] = [
  { valor: "01", rotulo: "01 — Tributável (alíquota básica)" },
  { valor: "02", rotulo: "02 — Tributável (alíquota diferenciada)" },
  { valor: "03", rotulo: "03 — Tributável (quantidade de unidade)" },
  { valor: "04", rotulo: "04 — Tributável (monofásica, alíquota zero)" },
  { valor: "06", rotulo: "06 — Alíquota zero" },
  { valor: "07", rotulo: "07 — Isenta" },
  { valor: "08", rotulo: "08 — Sem incidência" },
  { valor: "09", rotulo: "09 — Com suspensão" },
];
