import { describe, it, expect } from "vitest";
import {
  formatoData,
  dataInputParaUTC,
  dataParaInputValue,
  dataHoraInputParaUTC,
  dataHoraParaInputValue,
  dataEhPassado,
  limitesMesBrasilia,
  inicioMesAtualBrasilia,
  formatoInstanteReal,
  formatoInstanteRealComHora,
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

describe("limitesMesBrasilia", () => {
  it("início do mês em Brasília é 03:00 UTC do dia 1 (offset fixo de -3h)", () => {
    const { inicio, fim } = limitesMesBrasilia(2026, 7);
    expect(inicio.toISOString()).toBe("2026-07-01T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });

  it("virada de dezembro pra janeiro rola o ano corretamente", () => {
    const { inicio, fim } = limitesMesBrasilia(2026, 12);
    expect(inicio.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });
});

describe("inicioMesAtualBrasilia", () => {
  it("um instante às 22h de Brasília do último dia do mês ainda cai nesse mês, não no seguinte", () => {
    // 2026-07-31T22:00 em Brasília (UTC-3) = 2026-08-01T01:00:00Z — já é
    // dia 1 de agosto em UTC, mas ainda é 31 de julho em Brasília. Se o
    // helper usasse o calendário UTC (o que aconteceria na Vercel com
    // getFullYear()/getMonth() puro), isso cairia errado em agosto.
    const instante = new Date("2026-08-01T01:00:00.000Z");
    expect(inicioMesAtualBrasilia(instante).toISOString()).toBe("2026-07-01T03:00:00.000Z");
  });

  it("virada de dezembro pra janeiro: 22h de Brasília do dia 31/12 ainda é dezembro", () => {
    // 2026-12-31T22:00 em Brasília = 2027-01-01T01:00:00Z.
    const instante = new Date("2027-01-01T01:00:00.000Z");
    expect(inicioMesAtualBrasilia(instante).toISOString()).toBe("2026-12-01T03:00:00.000Z");
  });

  it("um instante claramente depois da virada (manhã do dia 1 em Brasília) já cai no mês novo", () => {
    // 2026-08-01T10:00:00Z = 07:00 em Brasília do dia 1 de agosto.
    const instante = new Date("2026-08-01T10:00:00.000Z");
    expect(inicioMesAtualBrasilia(instante).toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });
});

describe("formatoInstanteReal", () => {
  it("formata em pt-BR fixado em America/Sao_Paulo — um instante de madrugada em UTC ainda mostra o dia anterior em Brasília", () => {
    // 2026-08-01T01:00:00Z é 31/07/2026 22:00 em Brasília.
    const instante = new Date("2026-08-01T01:00:00.000Z");
    expect(formatoInstanteReal.format(instante)).toBe("31/07/2026");
  });
});

describe("formatoInstanteRealComHora", () => {
  it("formata data e hora juntas em America/Sao_Paulo", () => {
    const instante = new Date("2026-08-01T01:00:00.000Z");
    const formatado = formatoInstanteRealComHora.format(instante);
    expect(formatado).toContain("31/07/2026");
    expect(formatado).toContain("22:00");
  });
});
