import type { StatusPedido } from "@/generated/prisma/enums";

// Sem "server-only" de propósito — importado tanto por código de servidor
// (producao/status-transicao.ts) quanto por um client component
// (usuarios/ResponsaveisEstagioForm.tsx), mesma razão de modulos-permissao.ts.

export const SEQUENCIA_STATUS_PEDIDO: StatusPedido[] = [
  "FILA",
  "IMPRESSAO",
  "ACABAMENTO",
  "PRONTO",
  "ENTREGUE",
];

export const ROTULOS_STATUS_PEDIDO: Record<StatusPedido, string> = {
  FILA: "Na fila",
  IMPRESSAO: "Impressão",
  ACABAMENTO: "Acabamento",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

// As 3 etapas que podem ter responsável atribuído em /usuarios (e portanto
// disparar e-mail e permitir confirmação sem PRODUCAO.podeEditar completo).
// FILA fica de fora: é a transição que baixa matéria-prima do estoque e
// hoje exige a tela de confirmação/ajuste de perda de material — expor essa
// decisão a alguém sem acesso completo (por e-mail ou não) foi descartado
// de propósito. ENTREGUE/CANCELADO são terminais, não têm "confirmar".
export const ESTAGIOS_ATRIBUIVEIS: { valor: StatusPedido; rotulo: string }[] = (
  ["IMPRESSAO", "ACABAMENTO", "PRONTO"] as const
).map((valor) => ({ valor, rotulo: ROTULOS_STATUS_PEDIDO[valor] }));
