// Rótulos legíveis de TipoContaFinanceira — mesma ordem do enum no schema
// (11-financeiro.prisma). Achado A15 da Parte 4 da auditoria de abrangência.
export const ROTULO_TIPO_CONTA_FINANCEIRA: Record<string, string> = {
  CONTA_CORRENTE: "Conta corrente",
  CAIXA: "Caixa físico",
  POUPANCA: "Poupança",
  CARTEIRA_DIGITAL: "Carteira digital",
  OUTRO: "Outro",
};
