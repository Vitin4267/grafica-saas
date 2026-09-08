import { describe, it, expect } from "vitest";
import { resolverMaquinaAtualPedido, SELECAO_MAQUINA_VAZIA } from "./apontamento-etapa";

// Achado C1 da Parte 2 (Produção) da auditoria de abrangência (2026-09-07)
// — "a máquina deste card" pro Kanban (ver KanbanBoard.tsx). Arquivo
// separado de status-transicao.apontamento.test.ts (que já testa
// sugerirMaquinaPedido) porque aquele arquivo mistura testes de integração
// reais contra o Postgres (describe "ApontamentoEtapa") com os puros — este
// aqui é 100% puro, sem tocar prisma, então roda instantâneo e isolado.
describe("resolverMaquinaAtualPedido", () => {
  const itemComMaquina = (campo: "prensaId" | "maquinaFlexografiaId" | "impressoraDigitalId" | "maquinaSetupPorPecaId", id: string) => [
    {
      itemGrafica: {
        prensaId: null,
        maquinaFlexografiaId: null,
        impressoraDigitalId: null,
        maquinaSetupPorPecaId: null,
        [campo]: id,
      },
    },
  ];

  it("usa o ApontamentoEtapa aberto quando existe (1º sinal, mais preciso)", () => {
    const apontamento = { ...SELECAO_MAQUINA_VAZIA, prensaId: "prensa-apontada" };
    const itens = itemComMaquina("prensaId", "prensa-do-item"); // sinal diferente, não deveria ser usado
    expect(resolverMaquinaAtualPedido(apontamento, itens)).toBe("prensa-apontada");
  });

  it("cai pra sugerirMaquinaPedido (itens) quando NÃO há apontamento aberto", () => {
    const itens = itemComMaquina("maquinaFlexografiaId", "flexo-1");
    expect(resolverMaquinaAtualPedido(null, itens)).toBe("flexo-1");
  });

  it("cai pra sugerirMaquinaPedido quando o apontamento existe mas está totalmente vazio (etapa sem motor)", () => {
    const itens = itemComMaquina("impressoraDigitalId", "digital-1");
    expect(resolverMaquinaAtualPedido(SELECAO_MAQUINA_VAZIA, itens)).toBe("digital-1");
  });

  it("retorna null quando não há apontamento e a sugestão dos itens é ambígua", () => {
    const itens = [
      { itemGrafica: { prensaId: "prensa-1", maquinaFlexografiaId: null, impressoraDigitalId: null, maquinaSetupPorPecaId: null } },
      { itemGrafica: { prensaId: "prensa-2", maquinaFlexografiaId: null, impressoraDigitalId: null, maquinaSetupPorPecaId: null } },
    ];
    expect(resolverMaquinaAtualPedido(null, itens)).toBeNull();
  });

  it("retorna null quando não há nenhum sinal (sem apontamento, itens sem máquina configurada)", () => {
    const itens = [
      { itemGrafica: { prensaId: null, maquinaFlexografiaId: null, impressoraDigitalId: null, maquinaSetupPorPecaId: null } },
    ];
    expect(resolverMaquinaAtualPedido(null, itens)).toBeNull();
  });

  it("usa o equipamentoId do apontamento (sinal que os ITENS nunca têm, só ApontamentoEtapa)", () => {
    const apontamento = { ...SELECAO_MAQUINA_VAZIA, equipamentoId: "equipamento-1" };
    expect(resolverMaquinaAtualPedido(apontamento, [])).toBe("equipamento-1");
  });
});
