import { describe, it, expect } from "vitest";
import { proximoMes, mesmoMesOuDepois } from "./despesa-recorrente";

describe("proximoMes", () => {
  it("dia 31 em mês seguido de mês com 30 dias vira dia 30 (não 31, nem invalid date)", () => {
    // 31 de agosto -> setembro só tem 30 dias
    const resultado = proximoMes(new Date(Date.UTC(2026, 7, 31))); // 31/08/2026
    expect(resultado.getUTCFullYear()).toBe(2026);
    expect(resultado.getUTCMonth()).toBe(8); // setembro
    expect(resultado.getUTCDate()).toBe(30);
  });

  it("dia 31 de janeiro vira 28 quando fevereiro não é bissexto", () => {
    // 2026 não é bissexto
    const resultado = proximoMes(new Date(Date.UTC(2026, 0, 31))); // 31/01/2026
    expect(resultado.getUTCFullYear()).toBe(2026);
    expect(resultado.getUTCMonth()).toBe(1); // fevereiro
    expect(resultado.getUTCDate()).toBe(28);
  });

  it("dia 29 de janeiro vira 29 quando fevereiro é bissexto", () => {
    // 2028 é bissexto
    const resultado = proximoMes(new Date(Date.UTC(2028, 0, 29))); // 29/01/2028
    expect(resultado.getUTCFullYear()).toBe(2028);
    expect(resultado.getUTCMonth()).toBe(1); // fevereiro
    expect(resultado.getUTCDate()).toBe(29);
  });

  it("dia 31 de dezembro vira 31 de janeiro do ano seguinte (rollover de ano)", () => {
    const resultado = proximoMes(new Date(Date.UTC(2026, 11, 31))); // 31/12/2026
    expect(resultado.getUTCFullYear()).toBe(2027);
    expect(resultado.getUTCMonth()).toBe(0); // janeiro
    expect(resultado.getUTCDate()).toBe(31);
  });

  it("dia normal (sem ajuste) mantém o mesmo dia no mês seguinte", () => {
    const resultado = proximoMes(new Date(Date.UTC(2026, 2, 15))); // 15/03/2026
    expect(resultado.getUTCFullYear()).toBe(2026);
    expect(resultado.getUTCMonth()).toBe(3); // abril
    expect(resultado.getUTCDate()).toBe(15);
  });
});

describe("mesmoMesOuDepois", () => {
  it("mesmo mês e ano: true", () => {
    const data = new Date(Date.UTC(2026, 7, 20));
    const referencia = new Date(Date.UTC(2026, 7, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(true);
  });

  it("mês anterior ao da referência: false", () => {
    const data = new Date(Date.UTC(2026, 6, 31));
    const referencia = new Date(Date.UTC(2026, 7, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(false);
  });

  it("mês seguinte ao da referência: true", () => {
    const data = new Date(Date.UTC(2026, 8, 1));
    const referencia = new Date(Date.UTC(2026, 7, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(true);
  });

  it("virada de ano: dezembro do ano anterior é anterior a janeiro do ano seguinte", () => {
    const data = new Date(Date.UTC(2025, 11, 31));
    const referencia = new Date(Date.UTC(2026, 0, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(false);
  });

  it("virada de ano: janeiro do ano seguinte é mesmo mês/depois em relação a si mesmo", () => {
    const data = new Date(Date.UTC(2026, 0, 15));
    const referencia = new Date(Date.UTC(2026, 0, 1));
    expect(mesmoMesOuDepois(data, referencia)).toBe(true);
  });
});
