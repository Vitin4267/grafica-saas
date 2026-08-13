import { describe, it, expect } from "vitest";
import {
  formatoData,
  dataInputParaUTC,
  dataParaInputValue,
  dataHoraInputParaUTC,
  dataHoraParaInputValue,
  dataEhPassado,
} from "./data";

describe("dataInputParaUTC", () => {
  it("converte string de <input type=date> pra meia-noite UTC exata", () => {
    const data = dataInputParaUTC("2026-07-15");
    expect(data.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });
});

describe("dataParaInputValue", () => {
  it("é o inverso exato de dataInputParaUTC (round-trip sem perder dia)", () => {
    expect(dataParaInputValue(dataInputParaUTC("2026-07-15"))).toBe("2026-07-15");
    expect(dataParaInputValue(dataInputParaUTC("2026-01-01"))).toBe("2026-01-01");
    expect(dataParaInputValue(dataInputParaUTC("2026-12-31"))).toBe("2026-12-31");
  });
});

describe("dataHoraInputParaUTC", () => {
  it("converte string de <input type=datetime-local> pro horário exato, tratado como UTC literal", () => {
    const data = dataHoraInputParaUTC("2026-07-15T14:30");
    expect(data.toISOString()).toBe("2026-07-15T14:30:00.000Z");
  });
});

describe("dataHoraParaInputValue", () => {
  it("é o inverso exato de dataHoraInputParaUTC (round-trip sem perder minuto)", () => {
    expect(dataHoraParaInputValue(dataHoraInputParaUTC("2026-07-15T14:30"))).toBe("2026-07-15T14:30");
    expect(dataHoraParaInputValue(dataHoraInputParaUTC("2026-01-01T00:00"))).toBe("2026-01-01T00:00");
    expect(dataHoraParaInputValue(dataHoraInputParaUTC("2026-12-31T23:59"))).toBe("2026-12-31T23:59");
  });
});

describe("formatoData", () => {
  it("formata em pt-BR fixado em UTC — não varia com o fuso de quem roda o teste", () => {
    const data = dataInputParaUTC("2026-07-15");
    expect(formatoData.format(data)).toBe("15/07/2026");
  });
});

describe("dataEhPassado", () => {
  it("uma data de ontem é passado", () => {
    const ontem = new Date();
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    ontem.setUTCHours(0, 0, 0, 0);
    expect(dataEhPassado(ontem)).toBe(true);
  });

  it("uma data de amanhã não é passado", () => {
    const amanha = new Date();
    amanha.setUTCDate(amanha.getUTCDate() + 1);
    amanha.setUTCHours(0, 0, 0, 0);
    expect(dataEhPassado(amanha)).toBe(false);
  });

  it("hoje (meia-noite UTC) não é considerado passado", () => {
    const hoje = new Date();
    hoje.setUTCHours(0, 0, 0, 0);
    expect(dataEhPassado(hoje)).toBe(false);
  });
});
