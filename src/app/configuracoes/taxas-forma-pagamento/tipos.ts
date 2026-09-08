// Rótulos legíveis de FormaPagamento — mesma ordem do enum no schema
// (11-financeiro.prisma). Achado A11 da Parte 4 da auditoria de abrangência
// (2026-09-08). CARTAO continua na lista (legado, todo Pagamento/Despesa
// histórico ainda pode usar ele) ao lado dos valores novos e específicos
// (CARTAO_CREDITO/CARTAO_DEBITO/CHEQUE).
export const ROTULO_FORMA_PAGAMENTO: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão (genérico)",
  CARTAO_CREDITO: "Cartão de crédito",
  CARTAO_DEBITO: "Cartão de débito",
  BOLETO: "Boleto",
  CHEQUE: "Cheque",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};

export const FORMAS_PAGAMENTO_VALIDAS = [
  "DINHEIRO",
  "PIX",
  "CARTAO",
  "CARTAO_CREDITO",
  "CARTAO_DEBITO",
  "BOLETO",
  "CHEQUE",
  "TRANSFERENCIA",
  "OUTRO",
] as const;
