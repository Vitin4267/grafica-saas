export type StatusEntrega = "AGUARDANDO" | "EM_TRANSITO" | "ENTREGUE" | "PROBLEMA";

// Nunca confia no status enviado pelo client — só permite as transições
// abaixo, validadas de novo no servidor a partir do status atual lido do
// banco (mesmo padrão de TRANSICOES_VALIDAS em src/lib/compras-status.ts e
// src/lib/orcamento-status.ts). PROBLEMA é alcançável a partir de qualquer
// status ATIVO (AGUARDANDO, EM_TRANSITO) e, ao contrário de CANCELADO em
// compras-status.ts, não é terminal — dá pra resolver o problema e voltar
// pro fluxo normal (retomar em trânsito, marcar como entregue, ou até
// reiniciar em aguardando se a saída precisar ser refeita).
export const TRANSICOES_VALIDAS: Record<StatusEntrega, StatusEntrega[]> = {
  AGUARDANDO: ["EM_TRANSITO", "PROBLEMA"],
  EM_TRANSITO: ["ENTREGUE", "PROBLEMA"],
  ENTREGUE: [],
  PROBLEMA: ["AGUARDANDO", "EM_TRANSITO", "ENTREGUE"],
};

export const ROTULOS_STATUS_ENTREGA: Record<StatusEntrega, string> = {
  AGUARDANDO: "Aguardando",
  EM_TRANSITO: "Em trânsito",
  ENTREGUE: "Entregue",
  PROBLEMA: "Problema",
};

// Ordem de exibição — PROBLEMA por último de propósito, é o estado lateral
// que menos representa "andamento normal" da entrega.
export const ORDEM_STATUS_ENTREGA: StatusEntrega[] = ["AGUARDANDO", "EM_TRANSITO", "ENTREGUE", "PROBLEMA"];

// Estado terminal — nenhuma transição de saída. Usado pra decidir quando
// esconder o formulário de ação na tela (mesmo padrão de ehStatusTerminal
// em src/lib/compras-status.ts).
export function ehStatusTerminal(status: StatusEntrega): boolean {
  return TRANSICOES_VALIDAS[status].length === 0;
}

// Rótulo do botão de ação principal — só pros status com uma "próxima
// etapa natural" única e não-destrutiva (mesmo padrão de
// ROTULO_PROXIMA_ETAPA em src/lib/compras-status.ts). PROBLEMA fica de fora
// de propósito: tem 3 saídas possíveis sem uma "primária" óbvia, a tela
// mostra as 3 como opções explícitas em vez de escolher uma.
export const ROTULO_PROXIMA_ETAPA: Partial<Record<StatusEntrega, string>> = {
  AGUARDANDO: "Marcar como em trânsito",
  EM_TRANSITO: "Marcar como entregue",
};
