import type { StatusPedido } from "@/generated/prisma/enums";

// Sem "server-only" de propósito — importado tanto por código de servidor
// (producao/status-transicao.ts) quanto por um client component
// (usuarios/ResponsaveisEstagioForm.tsx), mesma razão de modulos-permissao.ts.

// FSM linear completa (visão de produto 2026-08-21, ver StatusPedido em
// prisma/schema.prisma): Arte → Clichê/Faca → Produção → Acabamento →
// Conferência → Embalagem → Expedição → Entregue. CANCELADO é terminal,
// alcançável de qualquer estágio antes de ENTREGUE, e por isso não entra
// nesta sequência (que é só o caminho "feliz" linear).
export const SEQUENCIA_STATUS_PEDIDO: StatusPedido[] = [
  "ARTE",
  "CLICHE_FACA",
  "PRODUCAO",
  "ACABAMENTO",
  "CONFERENCIA",
  "EMBALAGEM",
  "EXPEDICAO",
  "ENTREGUE",
];

export const ROTULOS_STATUS_PEDIDO: Record<StatusPedido, string> = {
  ARTE: "Arte",
  CLICHE_FACA: "Clichê/Faca",
  PRODUCAO: "Produção",
  ACABAMENTO: "Acabamento",
  CONFERENCIA: "Conferência",
  EMBALAGEM: "Embalagem",
  EXPEDICAO: "Expedição",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

// Os dois estágios "pré-produção" — nada físico começou a ser produzido
// ainda. Usado como gate do módulo de Entrega (ver Entrega em
// prisma/schema.prisma: "entrega só faz sentido depois que a produção
// física começou") e em qualquer outro lugar que precise diferenciar
// "ainda não é produção física" de "já é".
export const ESTAGIOS_PRE_PRODUCAO: StatusPedido[] = ["ARTE", "CLICHE_FACA"];

// As 5 etapas "vivas" que podem ter responsável atribuído em /usuarios (e
// portanto disparar e-mail e permitir confirmação sem PRODUCAO.podeEditar
// completo). ARTE (estágio inicial) e CLICHE_FACA (etapa que baixa
// matéria-prima do estoque ao ser deixada) ficam de fora — mesma razão de
// produto que excluía FILA antes: expor a tela de perda de material do
// estoque a um link sem login foi descartado de propósito. ENTREGUE/
// CANCELADO são terminais, não têm "confirmar".
export const ESTAGIOS_ATRIBUIVEIS: { valor: StatusPedido; rotulo: string }[] = (
  ["PRODUCAO", "ACABAMENTO", "CONFERENCIA", "EMBALAGEM", "EXPEDICAO"] as const
).map((valor) => ({ valor, rotulo: ROTULOS_STATUS_PEDIDO[valor] }));
