export type SituacaoTerceirizacao = "AGUARDANDO_ENVIO" | "ENVIADO" | "RETORNADO" | "PROBLEMA";

// Nunca confia na situação enviada pelo client — só permite as transições
// abaixo, validadas de novo no servidor a partir da situação atual lida do
// banco (mesmo padrão de TRANSICOES_VALIDAS em src/lib/entrega-status.ts e
// src/lib/compras-status.ts). PROBLEMA é alcançável a partir de qualquer
// situação ATIVA (AGUARDANDO_ENVIO, ENVIADO) e, igual StatusEntrega.PROBLEMA,
// não é terminal — dá pra resolver e voltar pro fluxo normal.
export const TRANSICOES_VALIDAS: Record<SituacaoTerceirizacao, SituacaoTerceirizacao[]> = {
  AGUARDANDO_ENVIO: ["ENVIADO", "PROBLEMA"],
  ENVIADO: ["RETORNADO", "PROBLEMA"],
  RETORNADO: [],
  PROBLEMA: ["AGUARDANDO_ENVIO", "ENVIADO", "RETORNADO"],
};

export const ROTULOS_SITUACAO_TERCEIRIZACAO: Record<SituacaoTerceirizacao, string> = {
  AGUARDANDO_ENVIO: "Aguardando envio",
  ENVIADO: "No terceiro",
  RETORNADO: "Retornado",
  PROBLEMA: "Problema",
};

// Ordem de exibição — PROBLEMA por último de propósito, mesmo critério de
// ORDEM_STATUS_ENTREGA em src/lib/entrega-status.ts.
export const ORDEM_SITUACAO_TERCEIRIZACAO: SituacaoTerceirizacao[] = [
  "AGUARDANDO_ENVIO",
  "ENVIADO",
  "RETORNADO",
  "PROBLEMA",
];

// Estado terminal — nenhuma transição de saída (mesmo padrão de
// ehStatusTerminal em src/lib/entrega-status.ts).
export function ehSituacaoTerminal(situacao: SituacaoTerceirizacao): boolean {
  return TRANSICOES_VALIDAS[situacao].length === 0;
}

// Rótulo do botão de ação principal — só pras situações com uma "próxima
// etapa natural" única e não-destrutiva (mesmo padrão de
// ROTULO_PROXIMA_ETAPA em src/lib/entrega-status.ts). PROBLEMA fica de fora
// de propósito: tem 3 saídas possíveis sem uma "primária" óbvia.
export const ROTULO_PROXIMA_ETAPA: Partial<Record<SituacaoTerceirizacao, string>> = {
  AGUARDANDO_ENVIO: "Marcar como enviado",
  ENVIADO: "Marcar como retornado",
};
