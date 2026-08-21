export type StatusOrcamento = "RASCUNHO" | "ENVIADO" | "APROVADO" | "REJEITADO";

// Nunca confia no status enviado pelo client — só permite as transições abaixo,
// validadas de novo no servidor a partir do status atual lido do banco.
// Reaproveitado tanto pela action autenticada (orcamento/[id]/actions.ts) quanto
// pela ação do link público (o/[token]/actions.ts) — a mesma regra nos dois lugares.
//
// ENVIADO → RASCUNHO existe pra "o cliente pediu ajuste" (solicitarAjusteOrcamento
// em o/[token]/actions.ts): reabre a edição normal, que já é gated por
// status===RASCUNHO em todo lugar, sem precisar de nenhum código extra pra
// destravar. APROVADO/REJEITADO continuam terminais, sem exceção.
export const TRANSICOES_VALIDAS: Record<StatusOrcamento, StatusOrcamento[]> = {
  RASCUNHO: ["ENVIADO"],
  ENVIADO: ["APROVADO", "REJEITADO", "RASCUNHO"],
  APROVADO: [],
  REJEITADO: [],
};

export const ROTULOS_STATUS_ORCAMENTO: Record<StatusOrcamento, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  APROVADO: "Aprovado",
  REJEITADO: "Rejeitado",
};

// "Expirado" é um estado COMPUTADO, não um valor de StatusOrcamento — evita
// cron job e status persistido. Um orçamento ENVIADO continua ENVIADO no
// banco pra sempre; isto só decide se ele ainda pode ser respondido.
export function orcamentoEstaExpirado(orcamento: {
  status: StatusOrcamento;
  validoAteEm: Date | null;
}): boolean {
  return (
    orcamento.status === "ENVIADO" &&
    orcamento.validoAteEm !== null &&
    orcamento.validoAteEm < new Date()
  );
}
