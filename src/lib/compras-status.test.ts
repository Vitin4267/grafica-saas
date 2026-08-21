import { describe, it, expect } from "vitest";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_SOLICITACAO_COMPRA,
  ORDEM_STATUS_SOLICITACAO_COMPRA,
  ehStatusTerminal,
  type StatusSolicitacaoCompra,
} from "./compras-status";

const TODOS_STATUS: StatusSolicitacaoCompra[] = [
  "SOLICITADO",
  "COTANDO",
  "APROVADO",
  "COMPRADO",
  "RECEBIDO",
  "CONFERIDO",
  "CANCELADO",
];

describe("TRANSICOES_VALIDAS", () => {
  it("SOLICITADO pode virar COTANDO, APROVADO (pulando cotação) ou CANCELADO", () => {
    expect(TRANSICOES_VALIDAS.SOLICITADO).toEqual(["COTANDO", "APROVADO", "CANCELADO"]);
  });

  it("COTANDO pode virar APROVADO ou CANCELADO", () => {
    expect(TRANSICOES_VALIDAS.COTANDO).toEqual(["APROVADO", "CANCELADO"]);
  });

  it("APROVADO pode virar COMPRADO ou CANCELADO", () => {
    expect(TRANSICOES_VALIDAS.APROVADO).toEqual(["COMPRADO", "CANCELADO"]);
  });

  it("COMPRADO pode virar RECEBIDO ou CANCELADO", () => {
    expect(TRANSICOES_VALIDAS.COMPRADO).toEqual(["RECEBIDO", "CANCELADO"]);
  });

  it("RECEBIDO só pode virar CONFERIDO — depois que o material chega, cancelar não é mais permitido", () => {
    expect(TRANSICOES_VALIDAS.RECEBIDO).toEqual(["CONFERIDO"]);
  });

  it("CONFERIDO e CANCELADO são estados terminais — nunca têm transição de saída", () => {
    // Invariante de negócio importante: uma vez conferida ou cancelada, a
    // solicitação nunca deve poder mudar de status de novo. Se isso quebrar,
    // é uma regressão séria (mesmo espírito do teste equivalente em
    // orcamento-status.test.ts).
    expect(TRANSICOES_VALIDAS.CONFERIDO).toEqual([]);
    expect(TRANSICOES_VALIDAS.CANCELADO).toEqual([]);
  });

  it("nenhum status tem transição pra si mesmo (sem loop)", () => {
    for (const status of TODOS_STATUS) {
      expect(TRANSICOES_VALIDAS[status]).not.toContain(status);
    }
  });

  it("nenhum status tem transição de volta pra SOLICITADO", () => {
    for (const status of TODOS_STATUS) {
      expect(TRANSICOES_VALIDAS[status]).not.toContain("SOLICITADO");
    }
  });

  it("CANCELADO só é alcançável a partir de estados ANTES de RECEBIDO", () => {
    const podemCancelar = TODOS_STATUS.filter((s) => TRANSICOES_VALIDAS[s].includes("CANCELADO"));
    expect(podemCancelar.sort()).toEqual(["APROVADO", "COMPRADO", "COTANDO", "SOLICITADO"].sort());
  });

  it("todo status tem um rótulo em português definido", () => {
    for (const status of TODOS_STATUS) {
      expect(ROTULOS_STATUS_SOLICITACAO_COMPRA[status]).toBeTruthy();
    }
  });

  it("ORDEM_STATUS_SOLICITACAO_COMPRA cobre exatamente todos os status, sem duplicar", () => {
    expect([...ORDEM_STATUS_SOLICITACAO_COMPRA].sort()).toEqual([...TODOS_STATUS].sort());
  });
});

describe("ehStatusTerminal", () => {
  it("CONFERIDO e CANCELADO são terminais", () => {
    expect(ehStatusTerminal("CONFERIDO")).toBe(true);
    expect(ehStatusTerminal("CANCELADO")).toBe(true);
  });

  it("os demais status não são terminais", () => {
    for (const status of TODOS_STATUS) {
      if (status === "CONFERIDO" || status === "CANCELADO") continue;
      expect(ehStatusTerminal(status)).toBe(false);
    }
  });
});
