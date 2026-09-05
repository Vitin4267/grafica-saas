import type { MotivoParada } from "@/generated/prisma/enums";

// Achado C2 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md, 2026-09-01) — rótulos/ordem de exibição
// de MotivoParada, compartilhados entre server (chip na lista/Kanban de
// producao/page.tsx) e client (ParadaPedidoSecao.tsx). Mesmo papel de
// ROTULOS_SITUACAO_TERCEIRIZACAO em src/lib/terceirizacao-status.ts — sem
// FSM de transições aqui porque ParadaPedido não tem estados intermediários,
// só ativa (finalizadaEm null) ou encerrada.
export const ROTULOS_MOTIVO_PARADA: Record<MotivoParada, string> = {
  AGUARDANDO_MATERIAL: "Aguardando material",
  AGUARDANDO_APROVACAO_CLIENTE: "Aguardando aprovação do cliente",
  AGUARDANDO_ARTE_CLIENTE: "Aguardando arte do cliente",
  MAQUINA_PARADA: "Máquina parada",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  FALTA_OPERADOR: "Falta de operador",
  OUTRO: "Outro",
};

// Ordem de exibição no select do formulário — OUTRO por último, mesmo
// critério de ORDEM_SITUACAO_TERCEIRIZACAO.
export const ORDEM_MOTIVO_PARADA: MotivoParada[] = [
  "AGUARDANDO_MATERIAL",
  "AGUARDANDO_APROVACAO_CLIENTE",
  "AGUARDANDO_ARTE_CLIENTE",
  "MAQUINA_PARADA",
  "AGUARDANDO_TERCEIRO",
  "FALTA_OPERADOR",
  "OUTRO",
];

// Rótulo pronto pra exibir — resolve "Outro: <motivoOutro>" quando aplicável
// (mesmo padrão de fornecedorNome resolvido no servidor em
// TerceirizacaoPedidoSecao). Usado tanto no chip curto quanto na linha de
// histórico detalhada.
export function rotuloMotivoParada(motivo: MotivoParada, motivoOutro: string | null): string {
  if (motivo === "OUTRO" && motivoOutro) return motivoOutro;
  return ROTULOS_MOTIVO_PARADA[motivo];
}
