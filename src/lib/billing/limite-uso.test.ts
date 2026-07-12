import { describe, it, expect } from "vitest";
import { limiteExcedido, deveBloquearPorLimite } from "./limite-uso";

describe("limiteExcedido", () => {
  it("dentro do limite não excede", () => {
    expect(limiteExcedido({ orcamentosMes: 10, usuarios: 1 }, { limiteOrcamentosMes: 30, limiteUsuarios: 2 })).toBe(false);
  });

  it("excede só por orçamentos", () => {
    expect(limiteExcedido({ orcamentosMes: 31, usuarios: 1 }, { limiteOrcamentosMes: 30, limiteUsuarios: 2 })).toBe(true);
  });

  it("excede só por usuários", () => {
    expect(limiteExcedido({ orcamentosMes: 5, usuarios: 3 }, { limiteOrcamentosMes: 30, limiteUsuarios: 2 })).toBe(true);
  });

  it("excede pelos dois eixos", () => {
    expect(limiteExcedido({ orcamentosMes: 200, usuarios: 20 }, { limiteOrcamentosMes: 30, limiteUsuarios: 2 })).toBe(true);
  });

  it("limite null (ilimitado) nunca excede naquele eixo", () => {
    expect(
      limiteExcedido({ orcamentosMes: 99999, usuarios: 99999 }, { limiteOrcamentosMes: null, limiteUsuarios: null })
    ).toBe(false);
  });

  it("exatamente no teto não excede (é o limite, não o excesso)", () => {
    expect(limiteExcedido({ orcamentosMes: 30, usuarios: 2 }, { limiteOrcamentosMes: 30, limiteUsuarios: 2 })).toBe(false);
  });
});

describe("deveBloquearPorLimite", () => {
  const agora = new Date("2026-07-16T12:00:00Z");

  it("nunca bloqueia se limiteExcedidoDesde é null", () => {
    expect(deveBloquearPorLimite(null, agora)).toBe(false);
  });

  it("não bloqueia antes dos 15 dias", () => {
    const desde = new Date("2026-07-10T12:00:00Z"); // 6 dias atrás
    expect(deveBloquearPorLimite(desde, agora)).toBe(false);
  });

  it("bloqueia exatamente no 15º dia", () => {
    const desde = new Date("2026-07-01T12:00:00Z"); // exatamente 15 dias atrás
    expect(deveBloquearPorLimite(desde, agora)).toBe(true);
  });

  it("bloqueia bem depois dos 15 dias", () => {
    const desde = new Date("2026-06-01T12:00:00Z");
    expect(deveBloquearPorLimite(desde, agora)).toBe(true);
  });
});
