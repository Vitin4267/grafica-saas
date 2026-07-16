import { describe, it, expect } from "vitest";
import { mapearStatusStripe, assinaturaEstaLiberada } from "./status";

describe("mapearStatusStripe", () => {
  it.each([
    ["trialing", "TRIALING"],
    ["active", "ATIVA"],
    ["past_due", "INADIMPLENTE"],
    ["unpaid", "INADIMPLENTE"],
    ["canceled", "CANCELADA"],
    ["incomplete_expired", "CANCELADA"],
    ["incomplete", "INADIMPLENTE"],
    ["paused", "INADIMPLENTE"],
  ] as const)("mapeia %s para %s", (statusStripe, esperado) => {
    expect(mapearStatusStripe(statusStripe)).toBe(esperado);
  });
});

describe("assinaturaEstaLiberada", () => {
  const agora = new Date("2026-07-11T12:00:00Z");

  it("bloqueia quando não há assinatura", () => {
    expect(assinaturaEstaLiberada(null, agora)).toBe(false);
  });

  it("libera quando status é ATIVA", () => {
    expect(assinaturaEstaLiberada({ status: "ATIVA", trialExpiraEm: null }, agora)).toBe(true);
  });

  it("libera TRIALING com trial ainda não vencido", () => {
    const trialExpiraEm = new Date("2026-07-20T00:00:00Z");
    expect(assinaturaEstaLiberada({ status: "TRIALING", trialExpiraEm }, agora)).toBe(true);
  });

  it("bloqueia TRIALING com trial já vencido", () => {
    const trialExpiraEm = new Date("2026-07-01T00:00:00Z");
    expect(assinaturaEstaLiberada({ status: "TRIALING", trialExpiraEm }, agora)).toBe(false);
  });

  it("libera TRIALING sem data de expiração definida", () => {
    expect(assinaturaEstaLiberada({ status: "TRIALING", trialExpiraEm: null }, agora)).toBe(true);
  });

  it("bloqueia INADIMPLENTE", () => {
    expect(assinaturaEstaLiberada({ status: "INADIMPLENTE", trialExpiraEm: null }, agora)).toBe(false);
  });

  it("bloqueia CANCELADA", () => {
    expect(assinaturaEstaLiberada({ status: "CANCELADA", trialExpiraEm: null }, agora)).toBe(false);
  });

  it("libera cortesia mesmo com status que normalmente bloqueia (CANCELADA)", () => {
    expect(
      assinaturaEstaLiberada({ status: "CANCELADA", trialExpiraEm: null, cortesia: true }, agora)
    ).toBe(true);
  });

  it("libera cortesia mesmo com status INADIMPLENTE", () => {
    expect(
      assinaturaEstaLiberada({ status: "INADIMPLENTE", trialExpiraEm: null, cortesia: true }, agora)
    ).toBe(true);
  });

  it("cortesia false não muda o comportamento normal", () => {
    expect(
      assinaturaEstaLiberada({ status: "CANCELADA", trialExpiraEm: null, cortesia: false }, agora)
    ).toBe(false);
  });
});
