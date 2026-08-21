import { describe, it, expect } from "vitest";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_ENTREGA,
  ORDEM_STATUS_ENTREGA,
  ehStatusTerminal,
  type StatusEntrega,
} from "./entrega-status";

const TODOS_STATUS: StatusEntrega[] = ["AGUARDANDO", "EM_TRANSITO", "ENTREGUE", "PROBLEMA"];

describe("TRANSICOES_VALIDAS", () => {
  it("AGUARDANDO pode virar EM_TRANSITO ou PROBLEMA", () => {
    expect(TRANSICOES_VALIDAS.AGUARDANDO).toEqual(["EM_TRANSITO", "PROBLEMA"]);
  });

  it("EM_TRANSITO pode virar ENTREGUE ou PROBLEMA", () => {
    expect(TRANSICOES_VALIDAS.EM_TRANSITO).toEqual(["ENTREGUE", "PROBLEMA"]);
  });

  it("ENTREGUE é terminal — nenhuma transição de saída", () => {
    // Invariante de negócio importante: uma vez entregue, a entrega nunca
    // deveria poder mudar de status de novo. Se isso quebrar, é uma
    // regressão séria (mesmo espírito do teste equivalente em
    // compras-status.test.ts / orcamento-status.test.ts).
    expect(TRANSICOES_VALIDAS.ENTREGUE).toEqual([]);
  });

  it("PROBLEMA NÃO é terminal — pode voltar pro fluxo normal (AGUARDANDO, EM_TRANSITO ou direto ENTREGUE)", () => {
    expect(TRANSICOES_VALIDAS.PROBLEMA).toEqual(["AGUARDANDO", "EM_TRANSITO", "ENTREGUE"]);
  });

  it("PROBLEMA é alcançável a partir de qualquer status ATIVO (AGUARDANDO, EM_TRANSITO)", () => {
    const podemVirarProblema = TODOS_STATUS.filter((s) => TRANSICOES_VALIDAS[s].includes("PROBLEMA"));
    expect(podemVirarProblema.sort()).toEqual(["AGUARDANDO", "EM_TRANSITO"].sort());
  });

  it("nenhum status tem transição pra si mesmo (sem loop)", () => {
    for (const status of TODOS_STATUS) {
      expect(TRANSICOES_VALIDAS[status]).not.toContain(status);
    }
  });

  it("todo status tem um rótulo em português definido", () => {
    for (const status of TODOS_STATUS) {
      expect(ROTULOS_STATUS_ENTREGA[status]).toBeTruthy();
    }
  });

  it("ORDEM_STATUS_ENTREGA cobre exatamente todos os status, sem duplicar", () => {
    expect([...ORDEM_STATUS_ENTREGA].sort()).toEqual([...TODOS_STATUS].sort());
  });
});

describe("ehStatusTerminal", () => {
  it("ENTREGUE é terminal", () => {
    expect(ehStatusTerminal("ENTREGUE")).toBe(true);
  });

  it("os demais status (incluindo PROBLEMA) não são terminais", () => {
    for (const status of TODOS_STATUS) {
      if (status === "ENTREGUE") continue;
      expect(ehStatusTerminal(status)).toBe(false);
    }
  });
});
