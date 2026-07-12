import { describe, it, expect } from "vitest";
import { tokenResetValido } from "./token-reset";

describe("tokenResetValido", () => {
  const agora = new Date("2026-07-12T12:00:00Z");

  it("válido: não usado e ainda não expirou", () => {
    const expiraEm = new Date("2026-07-12T13:00:00Z");
    expect(tokenResetValido({ expiraEm, usadoEm: null }, agora)).toBe(true);
  });

  it("inválido: já foi usado, mesmo dentro da janela de validade", () => {
    const expiraEm = new Date("2026-07-12T13:00:00Z");
    const usadoEm = new Date("2026-07-12T11:00:00Z");
    expect(tokenResetValido({ expiraEm, usadoEm }, agora)).toBe(false);
  });

  it("inválido: expirou", () => {
    const expiraEm = new Date("2026-07-12T11:00:00Z");
    expect(tokenResetValido({ expiraEm, usadoEm: null }, agora)).toBe(false);
  });

  it("inválido: expirou exatamente agora (não é mais válido no instante do limite)", () => {
    const expiraEm = new Date("2026-07-12T12:00:00Z");
    expect(tokenResetValido({ expiraEm, usadoEm: null }, agora)).toBe(false);
  });
});
