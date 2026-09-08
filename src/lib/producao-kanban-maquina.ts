// Achado C1 da Parte 2 (Produção) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-09-07) — agrupamento por máquina
// das sub-raias do Kanban dentro da coluna PRODUCAO (ver KanbanBoard.tsx).
// Extraído pra este módulo puro (sem "use client", sem dnd-kit, sem JSX) em
// vez de morar direto em KanbanBoard.tsx pelo mesmo motivo de
// producao-estagios.ts: o projeto ainda não tem jsdom/@testing-library
// configurado (ver vitest.config.ts), então um arquivo de teste só consegue
// exercitar lógica que não depende de DOM/React — mantendo a função aqui
// (genérica, structural typing) ela é testável sem precisar montar
// KanbanBoard inteiro.
export type PedidoComMaquina = {
  maquina: { nome: string; parada: boolean } | null;
};

// Agrupa (sem reordenar) os cards pela máquina resolvida
// (pedido.maquina?.nome, "Sem máquina definida" quando não há nenhum
// sinal). Usa Map em vez de exigir cards contíguos: quem chama já passa a
// lista ORDENADA por prioridade (não por máquina, ver
// compararPrioridadePedido em prioridade-pedido.ts), então dois cards da
// mesma máquina podem estar longe um do outro na lista de entrada — o
// agrupamento continua juntando os dois no mesmo grupo; só a ORDEM dos
// GRUPOS entre si segue a ordem de primeira aparição (mais prioritário
// primeiro, indiretamente). Puramente uma decisão de RENDERIZAÇÃO: não vira
// zona de soltar própria no Kanban — nenhum Gantt/capacidade finita aqui,
// fora de escopo desta rodada (ver proposta MVP do achado).
export function agruparPorMaquina<T extends PedidoComMaquina>(
  pedidos: T[]
): { nome: string; parada: boolean; pedidos: T[] }[] {
  const ordem: string[] = [];
  const porNome = new Map<string, { nome: string; parada: boolean; pedidos: T[] }>();
  for (const pedido of pedidos) {
    const nome = pedido.maquina?.nome ?? "Sem máquina definida";
    let grupo = porNome.get(nome);
    if (!grupo) {
      grupo = { nome, parada: pedido.maquina?.parada ?? false, pedidos: [] };
      porNome.set(nome, grupo);
      ordem.push(nome);
    }
    grupo.pedidos.push(pedido);
  }
  return ordem.map((nome) => porNome.get(nome)!);
}
