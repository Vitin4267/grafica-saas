import { describe, it, expect } from "vitest";
import { calcularTaxaConversao, calcularTempoMedioAprovacaoDias } from "./funil-conversao";

describe("calcularTaxaConversao", () => {
  it("retorna null quando não há orçamentos fora de RASCUNHO", () => {
    const resultado = calcularTaxaConversao([
      { status: "RASCUNHO", quantidade: 5 },
      { status: "ENVIADO", quantidade: 0 },
      { status: "APROVADO", quantidade: 0 },
      { status: "REJEITADO", quantidade: 0 },
    ]);
    expect(resultado.percentual).toBeNull();
    expect(resultado.saidosDeRascunho).toBe(0);
  });

  it("calcula o percentual sobre enviados + aprovados + rejeitados, ignorando rascunho", () => {
    // 10 saíram de rascunho (4 enviados parados + 5 aprovados + 1 rejeitado), 5 viraram pedido -> 50%
    const resultado = calcularTaxaConversao([
      { status: "RASCUNHO", quantidade: 20 },
      { status: "ENVIADO", quantidade: 4 },
      { status: "APROVADO", quantidade: 5 },
      { status: "REJEITADO", quantidade: 1 },
    ]);
    expect(resultado.saidosDeRascunho).toBe(10);
    expect(resultado.aprovados).toBe(5);
    expect(resultado.percentual).toBeCloseTo(50, 5);
  });

  it("dá 100% quando todo mundo que saiu de rascunho aprovou", () => {
    const resultado = calcularTaxaConversao([
      { status: "RASCUNHO", quantidade: 0 },
      { status: "ENVIADO", quantidade: 0 },
      { status: "APROVADO", quantidade: 3 },
      { status: "REJEITADO", quantidade: 0 },
    ]);
    expect(resultado.percentual).toBe(100);
  });

  it("ignora status desconhecidos e falta de entradas no array", () => {
    const resultado = calcularTaxaConversao([{ status: "APROVADO", quantidade: 2 }]);
    expect(resultado.saidosDeRascunho).toBe(2);
    expect(resultado.percentual).toBe(100);
  });
});

describe("calcularTempoMedioAprovacaoDias", () => {
  it("retorna null quando não há orçamentos aprovados com resposta pública", () => {
    expect(calcularTempoMedioAprovacaoDias([])).toBeNull();
    expect(
      calcularTempoMedioAprovacaoDias([
        { createdAt: new Date("2026-08-01T00:00:00Z"), respostaPublicaEm: null },
      ])
    ).toBeNull();
  });

  it("calcula a média em dias entre createdAt e respostaPublicaEm", () => {
    const resultado = calcularTempoMedioAprovacaoDias([
      // 2 dias
      {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        respostaPublicaEm: new Date("2026-08-03T00:00:00Z"),
      },
      // 4 dias
      {
        createdAt: new Date("2026-08-05T00:00:00Z"),
        respostaPublicaEm: new Date("2026-08-09T00:00:00Z"),
      },
    ]);
    expect(resultado).toBeCloseTo(3, 5);
  });

  it("ignora aprovações internas sem respostaPublicaEm no cálculo da média", () => {
    const resultado = calcularTempoMedioAprovacaoDias([
      {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        respostaPublicaEm: new Date("2026-08-02T00:00:00Z"),
      },
      { createdAt: new Date("2026-08-05T00:00:00Z"), respostaPublicaEm: null },
    ]);
    expect(resultado).toBeCloseTo(1, 5);
  });

  it("aceita frações de dia (aprovação em poucas horas)", () => {
    const resultado = calcularTempoMedioAprovacaoDias([
      {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        respostaPublicaEm: new Date("2026-08-01T12:00:00Z"),
      },
    ]);
    expect(resultado).toBeCloseTo(0.5, 5);
  });
});
