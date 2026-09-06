// Rótulos legíveis de AncoraVencimento — mesma ordem do enum no schema
// (09-orcamento.prisma). Achado A7 da Parte 4 da auditoria de abrangência.
// OUTRO é deliberadamente "sem gatilho" (ver comentário no enum) — a
// gráfica sempre cadastra a parcela à mão quando escolhe essa âncora.
export const ROTULO_ANCORA_VENCIMENTO: Record<string, string> = {
  APROVACAO: "Aprovação do orçamento",
  EMISSAO_NOTA: "Emissão da nota fiscal",
  ENTREGA: "Entrega do pedido",
  OUTRO: "Outro (sem geração automática)",
};
