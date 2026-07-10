export type StatusOrcamento = "RASCUNHO" | "ENVIADO" | "APROVADO" | "REJEITADO";

// Nunca confia no status enviado pelo client — só permite as transições abaixo,
// validadas de novo no servidor a partir do status atual lido do banco.
// Reaproveitado tanto pela action autenticada (orcamento/[id]/actions.ts) quanto
// pela ação do link público (o/[token]/actions.ts) — a mesma regra nos dois lugares.
export const TRANSICOES_VALIDAS: Record<StatusOrcamento, StatusOrcamento[]> = {
  RASCUNHO: ["ENVIADO"],
  ENVIADO: ["APROVADO", "REJEITADO"],
  APROVADO: [],
  REJEITADO: [],
};

export const ROTULOS_STATUS_ORCAMENTO: Record<StatusOrcamento, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  APROVADO: "Aprovado",
  REJEITADO: "Rejeitado",
};
