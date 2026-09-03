import type { StatusPedido } from "@/generated/prisma/enums";

// Sem "server-only" de propósito — importado tanto por código de servidor
// quanto por client components, mesma razão de modulos-permissao.ts.
//
// Achado A1 da auditoria de abrangência (Parte 2/Produção), Fase 1
// (2026-09-02): estas 3 constantes deixaram de ser a fonte de verdade em
// tempo de execução — viraram só o PADRÃO/DEFAULT do sistema (o "rótulo de
// fábrica" e a sequência de uma gráfica que nunca configurou nada). Todo
// código que decide "qual é a sequência/rótulo/estágio-pré-produção/
// estágio-atribuível DESTA gráfica" deve chamar resolverEtapasGrafica (ou
// um dos helpers) em src/lib/etapa-grafica.ts, que lê o override por tenant
// em EtapaGrafica e cai automaticamente nestes valores aqui quando a
// gráfica não tem nenhuma linha configurada (bootstrap lazy). Continuam
// exportadas: são a semente do bootstrap e o fallback de qualquer lugar que
// só precise mesmo do padrão fixo (ex: rótulo de e-mail/PDF genérico fora
// do contexto de uma gráfica).

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
