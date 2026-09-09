import { describe, it, expect } from "vitest";
import { calcularCoberturaOverhead, type EntradaCoberturaOverhead } from "@/lib/cobertura-overhead";

// Teste UNITÁRIO (função pura, sem banco) — achado A2 da Parte 4 da
// auditoria de abrangência (pesquisa-abrangencia-modulos.md). Casos
// sintéticos, mesmo padrão de dre.test.ts.

function entradaBase(overrides: Partial<EntradaCoberturaOverhead> = {}): EntradaCoberturaOverhead {
  return {
    overheadCobrado: 5_000,
    custoFixoPago: 8_000,
    receitaBruta: 100_000,
    ...overrides,
  };
}

describe("calcularCoberturaOverhead", () => {
  it("overhead cobrado cobre MENOS que o custo fixo real — diferença positiva", () => {
    const resultado = calcularCoberturaOverhead(entradaBase({ overheadCobrado: 5_000, custoFixoPago: 8_000 }));

    expect(resultado.overheadCobrado).toBe(5_000);
    expect(resultado.custoFixoPago).toBe(8_000);
    expect(resultado.diferenca).toBe(3_000);
    // 8.000 / 100.000 * 100 = 8%
    expect(resultado.percentualQueFecharia).toBeCloseTo(8, 10);
  });

  it("overhead cobrado cobre MAIS que o custo fixo real — diferença negativa", () => {
    const resultado = calcularCoberturaOverhead(entradaBase({ overheadCobrado: 12_000, custoFixoPago: 8_000 }));

    expect(resultado.diferenca).toBe(-4_000);
    expect(resultado.percentualQueFecharia).toBeCloseTo(8, 10);
  });

  it("overhead cobrado é EXATAMENTE igual ao custo fixo real — diferença zero", () => {
    const resultado = calcularCoberturaOverhead(entradaBase({ overheadCobrado: 8_000, custoFixoPago: 8_000 }));

    expect(resultado.diferenca).toBe(0);
  });

  it("sem nenhum orçamento aprovado no período — tudo zero, sem dividir por zero", () => {
    const resultado = calcularCoberturaOverhead({
      overheadCobrado: 0,
      custoFixoPago: 0,
      receitaBruta: 0,
    });

    expect(resultado.overheadCobrado).toBe(0);
    expect(resultado.custoFixoPago).toBe(0);
    expect(resultado.diferenca).toBe(0);
    expect(resultado.percentualQueFecharia).toBeNull();
  });

  it("receitaBruta zero mas custo fixo pago > 0 (ex: aluguel pago sem nenhum orçamento aprovado no mês) — percentual indefinido, não Infinity/NaN", () => {
    const resultado = calcularCoberturaOverhead({
      overheadCobrado: 0,
      custoFixoPago: 3_000,
      receitaBruta: 0,
    });

    expect(resultado.diferenca).toBe(3_000);
    expect(resultado.percentualQueFecharia).toBeNull();
  });
});
