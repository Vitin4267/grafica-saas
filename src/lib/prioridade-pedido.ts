// Achado C1 da Parte 2 (Produção) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-09-07): antes desta feature, a fila
// de produção só tinha uma ordem possível — createdAt da query (mais antigo
// primeiro) — sem nenhuma noção de "isso é mais urgente que aquilo". Módulo
// puro (sem Prisma, sem "server-only") porque é importado tanto por Server
// Components (producao/page.tsx, pra ordenar o Kanban) quanto por Client
// Components (KanbanBoard.tsx, PedidoLinha.tsx, PrioridadePedidoSeletor.tsx,
// pra rotular o valor salvo) — mesmo padrão de producao-estagios.ts.

// 4 níveis fixos em vez de um input numérico livre: decisão de UX (público
// leigo, ver princípio já estabelecido no projeto) — "quanto maior o
// número, mais prioritário" não é intuitivo pra quem opera a gráfica no dia
// a dia, e um <select> com rótulos não erra e não precisa de explicação.
// NORMAL=0 é o valor que TODO pedido já tem hoje (Pedido.prioridade
// @default(0)) — escolhido de propósito pra "nunca mexeu nisso" continuar
// se comportando exatamente como antes da feature (fica no meio da fila
// por prazo/data, não pulando pra frente nem pra trás). Espaçados de 10 em
// 10 (não 1 em 1) só pra deixar respiro caso um nível intermediário seja
// pedido no futuro — não há hoje nenhum código que dependa do espaçamento
// exato, só da ORDEM relativa.
export const NIVEIS_PRIORIDADE_PEDIDO = [
  { valor: -10, rotulo: "Baixa" },
  { valor: 0, rotulo: "Normal" },
  { valor: 10, rotulo: "Alta" },
  { valor: 20, rotulo: "Urgente" },
] as const;

export type NivelPrioridadePedido = (typeof NIVEIS_PRIORIDADE_PEDIDO)[number]["valor"];

export function ehNivelPrioridadeValido(valor: number): valor is NivelPrioridadePedido {
  return NIVEIS_PRIORIDADE_PEDIDO.some((nivel) => nivel.valor === valor);
}

// Fallback "Prioridade N" pra um valor fora dos 4 fixos acima — não deveria
// acontecer na prática (a única Server Action que escreve o campo,
// alterarPrioridadePedido, valida contra ehNivelPrioridadeValido antes de
// gravar), mas um pedido antigo ou um valor gravado por fora da UI (seed,
// script) não pode quebrar a tela.
export function rotuloPrioridadePedido(prioridade: number): string {
  const encontrado = NIVEIS_PRIORIDADE_PEDIDO.find((nivel) => nivel.valor === prioridade);
  return encontrado ? encontrado.rotulo : `Prioridade ${prioridade}`;
}

// Formato mínimo de um Pedido pra comparar — os call-sites reais passam a
// linha inteira vinda do Prisma (mais campos), TypeScript aceita por
// structural typing (mesmo padrão de RegistroComMaquina em
// manutencao-maquina.ts).
export type PedidoOrdenavelPorPrioridade = {
  prioridade: number;
  prazoEntrega: Date | null;
  createdAt: Date;
};

// Ordem do Kanban (achado C1, proposta MVP): prioridade desc, prazoEntrega
// asc (sem prazo fica por último dentro do mesmo nível de prioridade — não
// tem data pra competir com quem tem), createdAt asc (critério de
// desempate final, mesmo comportamento de HOJE preservado pra dois pedidos
// com prioridade e prazo iguais). Um pedido que nunca teve a prioridade
// alterada (prioridade=0, o @default) e nunca teve prazoEntrega definido
// continua exatamente na mesma posição relativa de antes desta feature —
// zero regressão pro comportamento default.
export function compararPrioridadePedido(
  a: PedidoOrdenavelPorPrioridade,
  b: PedidoOrdenavelPorPrioridade
): number {
  if (a.prioridade !== b.prioridade) return b.prioridade - a.prioridade;

  const prazoA = a.prazoEntrega ? a.prazoEntrega.getTime() : Number.POSITIVE_INFINITY;
  const prazoB = b.prazoEntrega ? b.prazoEntrega.getTime() : Number.POSITIVE_INFINITY;
  if (prazoA !== prazoB) return prazoA - prazoB;

  return a.createdAt.getTime() - b.createdAt.getTime();
}
