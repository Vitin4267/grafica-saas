import { describe, it, expect } from "vitest";
import { TRANSICOES_VALIDAS, ROTULOS_STATUS_ORCAMENTO, type StatusOrcamento } from "./orcamento-status";

const TODOS_STATUS: StatusOrcamento[] = ["RASCUNHO", "ENVIADO", "APROVADO", "REJEITADO"];

describe("TRANSICOES_VALIDAS", () => {
  it("RASCUNHO só pode virar ENVIADO", () => {
    expect(TRANSICOES_VALIDAS.RASCUNHO).toEqual(["ENVIADO"]);
  });

  it("ENVIADO pode virar APROVADO ou REJEITADO", () => {
    expect(TRANSICOES_VALIDAS.ENVIADO).toEqual(["APROVADO", "REJEITADO"]);
  });

  it("APROVADO e REJEITADO são estados terminais — nunca têm transição de saída", () => {
    // Invariante de negócio importante: uma vez aprovado ou rejeitado, o
    // orçamento nunca deve poder mudar de status de novo (ver comentário em
    // atualizarStatusOrcamento). Se isso quebrar, é uma regressão séria.
    expect(TRANSICOES_VALIDAS.APROVADO).toEqual([]);
    expect(TRANSICOES_VALIDAS.REJEITADO).toEqual([]);
  });

  it("nenhum status tem transição pra si mesmo (sem loop)", () => {
    for (const status of TODOS_STATUS) {
      expect(TRANSICOES_VALIDAS[status]).not.toContain(status);
    }
  });

  it("nenhum status tem transição de volta pra RASCUNHO", () => {
    for (const status of TODOS_STATUS) {
      expect(TRANSICOES_VALIDAS[status]).not.toContain("RASCUNHO");
    }
  });

  it("todo status tem um rótulo em português definido", () => {
    for (const status of TODOS_STATUS) {
      expect(ROTULOS_STATUS_ORCAMENTO[status]).toBeTruthy();
    }
  });
});
