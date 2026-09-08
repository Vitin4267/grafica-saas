// Achado A10 da auditoria de abrangência (Parte 4/Financeiro,
// pesquisa-abrangencia-modulos.md) — ParametrosGrafica.impostoPercent é um
// número fixo que não acompanha o crescimento da gráfica. No Simples
// Nacional a alíquota efetiva CRESCE com o RBT12 (faturamento bruto
// acumulado nos últimos 12 meses, ver simples-nacional-db.ts pra como isso é
// apurado a partir dos dados do tenant). Este arquivo é só a MATEMÁTICA da
// lei (pura, sem Prisma) — a decisão de comparar/avisar mora em
// pendencias-configuracao.ts.
//
// Escopo deliberadamente restrito (não é motor tributário completo, ver
// proposta do achado A10): só o Anexo III, que é o mais comum pra
// serviço/indústria gráfica de pequeno porte (impressão sob encomenda,
// personalização, rótulos/etiquetas). NÃO calcula Fator R (que decidiria
// Anexo III vs Anexo V) nem cobre Anexo I (comércio/revenda) ou Anexo II
// (indústria com folha de pagamento baixa) — DadosFiscaisGrafica.
// regimeTributario hoje só distingue SIMPLES_NACIONAL/LUCRO_PRESUMIDO/
// LUCRO_REAL, sem o Anexo dentro do Simples (limitação conhecida,
// documentada aqui e avisada na tela — ver ParametrosForm.tsx).
export type FaixaAnexoIII = {
  // Teto de RBT12 desta faixa (inclusive). A última faixa é o teto do
  // Simples Nacional inteiro (R$4,8mi) — RBT12 acima disso já não é mais
  // Simples de verdade (desenquadramento), tratado como aproximação por
  // quem chama calcularAliquotaEfetivaSimples.
  ateRbt12: number;
  aliquotaNominal: number; // decimal, ex: 0.06 = 6%
  parcelaDedutivel: number; // R$, "PD" da fórmula oficial
};

// Tabela de faixas do Simples Nacional — Anexo III (LC 123/2006, Anexo III
// atualizado pela LC 155/2016, em vigor desde 2018 e sem mudança de valor
// desde então). É tabela da LEI, pública e igual pra qualquer empresa do
// país — por isso hardcoded como constante, não campo configurável por
// tenant (mesmo raciocínio de nota-fiscal-tabelas.ts pros códigos CST/
// CSOSN).
export const FAIXAS_ANEXO_III: readonly FaixaAnexoIII[] = [
  { ateRbt12: 180_000, aliquotaNominal: 0.06, parcelaDedutivel: 0 },
  { ateRbt12: 360_000, aliquotaNominal: 0.112, parcelaDedutivel: 9_360 },
  { ateRbt12: 720_000, aliquotaNominal: 0.135, parcelaDedutivel: 17_640 },
  { ateRbt12: 1_800_000, aliquotaNominal: 0.16, parcelaDedutivel: 35_640 },
  { ateRbt12: 3_600_000, aliquotaNominal: 0.21, parcelaDedutivel: 125_640 },
  { ateRbt12: 4_800_000, aliquotaNominal: 0.33, parcelaDedutivel: 648_000 },
] as const;

export type AliquotaSimplesCalculada = {
  // Índice 0-based em FAIXAS_ANEXO_III — útil pra exibir "faixa 3 de 6" na
  // tela sem recalcular.
  faixaIndice: number;
  aliquotaNominal: number;
  parcelaDedutivel: number;
  aliquotaEfetiva: number; // decimal, comparável direto com impostoPercent
};

// Fórmula oficial do Simples Nacional (LC 123/2006, art. 18, §1º-A):
// Alíquota efetiva = (RBT12 × Alíquota nominal da faixa − Parcela a
// Deduzir) ÷ RBT12. RBT12 <= 0 (gráfica nova, sem faturamento apurado ainda)
// cai na 1ª faixa sem aplicar a fórmula (divisão por zero) — alíquota
// nominal da 1ª faixa é também a efetiva lá (parcela dedutível = 0).
export function calcularAliquotaEfetivaSimples(rbt12: number): AliquotaSimplesCalculada {
  if (rbt12 <= 0) {
    const primeira = FAIXAS_ANEXO_III[0];
    return {
      faixaIndice: 0,
      aliquotaNominal: primeira.aliquotaNominal,
      parcelaDedutivel: primeira.parcelaDedutivel,
      aliquotaEfetiva: primeira.aliquotaNominal,
    };
  }

  // Acima do teto da última faixa (desenquadramento do Simples de verdade,
  // fora de escopo tratar aqui) usa a última faixa como aproximação — melhor
  // avisar com um número conservador do que não avisar nada.
  const indice = FAIXAS_ANEXO_III.findIndex((f) => rbt12 <= f.ateRbt12);
  const faixa = indice === -1 ? FAIXAS_ANEXO_III[FAIXAS_ANEXO_III.length - 1] : FAIXAS_ANEXO_III[indice];
  const aliquotaEfetiva = (rbt12 * faixa.aliquotaNominal - faixa.parcelaDedutivel) / rbt12;

  return {
    faixaIndice: indice === -1 ? FAIXAS_ANEXO_III.length - 1 : indice,
    aliquotaNominal: faixa.aliquotaNominal,
    parcelaDedutivel: faixa.parcelaDedutivel,
    aliquotaEfetiva,
  };
}
