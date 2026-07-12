import { describe, it, expect } from "vitest";
import { codigoVerificacaoValido, LIMITE_TENTATIVAS } from "./verificacao-email";

describe("codigoVerificacaoValido", () => {
  const agora = new Date("2026-07-12T12:00:00Z");

  it("válido: não usado, não expirou, sem tentativas esgotadas", () => {
    const expiraEm = new Date("2026-07-12T12:15:00Z");
    expect(codigoVerificacaoValido({ expiraEm, usadoEm: null, tentativas: 0 }, agora)).toBe(true);
  });

  it("inválido: já foi usado, mesmo dentro da janela de validade", () => {
    const expiraEm = new Date("2026-07-12T12:15:00Z");
    const usadoEm = new Date("2026-07-12T11:55:00Z");
    expect(codigoVerificacaoValido({ expiraEm, usadoEm, tentativas: 0 }, agora)).toBe(false);
  });

  it("inválido: expirou", () => {
    const expiraEm = new Date("2026-07-12T11:00:00Z");
    expect(codigoVerificacaoValido({ expiraEm, usadoEm: null, tentativas: 0 }, agora)).toBe(false);
  });

  it("inválido: expirou exatamente agora (não é mais válido no instante do limite)", () => {
    const expiraEm = new Date("2026-07-12T12:00:00Z");
    expect(codigoVerificacaoValido({ expiraEm, usadoEm: null, tentativas: 0 }, agora)).toBe(false);
  });

  it("inválido: tentativas esgotadas, mesmo com prazo e uso ok", () => {
    const expiraEm = new Date("2026-07-12T12:15:00Z");
    expect(
      codigoVerificacaoValido({ expiraEm, usadoEm: null, tentativas: LIMITE_TENTATIVAS }, agora)
    ).toBe(false);
  });

  it("válido: uma tentativa a menos do limite ainda é aceito", () => {
    const expiraEm = new Date("2026-07-12T12:15:00Z");
    expect(
      codigoVerificacaoValido(
        { expiraEm, usadoEm: null, tentativas: LIMITE_TENTATIVAS - 1 },
        agora
      )
    ).toBe(true);
  });
});
