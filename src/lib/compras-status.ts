export type StatusSolicitacaoCompra =
  | "SOLICITADO"
  | "COTANDO"
  | "APROVADO"
  | "COMPRADO"
  | "RECEBIDO"
  | "CONFERIDO"
  | "CANCELADO";

// Nunca confia no status enviado pelo client — só permite as transições
// abaixo, validadas de novo no servidor a partir do status atual lido do
// banco (mesmo padrão de TRANSICOES_VALIDAS em src/lib/orcamento-status.ts).
// CANCELADO é alcançável a partir de qualquer estado ANTES de RECEBIDO —
// depois que o material chega fisicamente (RECEBIDO/CONFERIDO), cancelar a
// solicitação não desfaz uma entrada de estoque já confirmada (mesma lógica
// de StatusPedido.CANCELADO nunca ser alcançável a partir de ENTREGUE).
export const TRANSICOES_VALIDAS: Record<StatusSolicitacaoCompra, StatusSolicitacaoCompra[]> = {
  SOLICITADO: ["COTANDO", "APROVADO", "CANCELADO"],
  COTANDO: ["APROVADO", "CANCELADO"],
  APROVADO: ["COMPRADO", "CANCELADO"],
  COMPRADO: ["RECEBIDO", "CANCELADO"],
  RECEBIDO: ["CONFERIDO"],
  CONFERIDO: [],
  CANCELADO: [],
};

export const ROTULOS_STATUS_SOLICITACAO_COMPRA: Record<StatusSolicitacaoCompra, string> = {
  SOLICITADO: "Solicitado",
  COTANDO: "Cotando",
  APROVADO: "Aprovado",
  COMPRADO: "Comprado",
  RECEBIDO: "Recebido",
  CONFERIDO: "Conferido",
  CANCELADO: "Cancelado",
};

// Ordem de exibição das colunas na tela /compras (lista agrupada por
// status) — CANCELADO por último de propósito, junto com CONFERIDO, são os
// dois estados terminais que menos precisam de atenção no dia a dia.
export const ORDEM_STATUS_SOLICITACAO_COMPRA: StatusSolicitacaoCompra[] = [
  "SOLICITADO",
  "COTANDO",
  "APROVADO",
  "COMPRADO",
  "RECEBIDO",
  "CONFERIDO",
  "CANCELADO",
];

// Estados terminais — nenhuma transição de saída (nem pra CANCELADO). Usado
// pra decidir quando esconder os botões/formulário de ação na tela de
// detalhe.
export function ehStatusTerminal(status: StatusSolicitacaoCompra): boolean {
  return TRANSICOES_VALIDAS[status].length === 0;
}

// O rótulo do botão de ação principal (sempre a PRIMEIRA transição válida
// listada, que é a "próxima etapa natural" do fluxo — CANCELADO nunca é o
// primeiro item da lista, ver TRANSICOES_VALIDAS acima) — mesmo padrão de
// PROXIMO_ROTULO em src/app/producao/AvancarPedidoButton.tsx.
export const ROTULO_PROXIMA_ETAPA: Partial<Record<StatusSolicitacaoCompra, string>> = {
  SOLICITADO: "Iniciar cotação",
  COTANDO: "Aprovar",
  APROVADO: "Marcar como comprado",
  COMPRADO: "Confirmar recebimento",
  RECEBIDO: "Conferir",
};
