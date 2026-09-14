import { describe, it, expect } from "vitest";
import { calcularCoberturaOverhead, type EntradaCoberturaOverhead } from "@/lib/cobertura-overhead";

// Teste UNITÁRIO (função pura, sem banco) — achado A2 da Parte 4 da
// auditoria de abrangência (pesquisa-abrangencia-modulos.md). Casos
// sintéticos, mesmo padrão de dre.test.ts.

function entradaBase(overrides: Partial<EntradaCoberturaOverhead> = {}): EntradaCoberturaOverhead {
  return {
    overheadCobrado: 5_000,
    custoFixoPago: 8_000,
    custoDiretoAgregado: 40_000,
    // Achado N30 — default sem nenhum item SIMPLES (100% da receita
    // rastreada), mesmo comportamento de sempre pra quem só usa o motor
    // avançado; receitaTotalAprovada = custoDiretoAgregado é só uma
    // convenção do fixture (não uma relação real entre os dois campos).
    receitaTotalAprovada: 40_000,
    receitaSemCustoDireto: 0,
    ...overrides,
  };
}

describe("calcularCoberturaOverhead", () => {
  it("overhead cobrado cobre MENOS que o custo fixo real — diferença positiva", () => {
    const resultado = calcularCoberturaOverhead(entradaBase({ overheadCobrado: 5_000, custoFixoPago: 8_000 }));

    expect(resultado.overheadCobrado).toBe(5_000);
    expect(resultado.custoFixoPago).toBe(8_000);
    expect(resultado.diferenca).toBe(3_000);
    // 8.000 / 40.000 * 100 = 20%
    expect(resultado.percentualQueFecharia).toBeCloseTo(20, 10);
  });

  it("overhead cobrado cobre MAIS que o custo fixo real — diferença negativa", () => {
    const resultado = calcularCoberturaOverhead(entradaBase({ overheadCobrado: 12_000, custoFixoPago: 8_000 }));

    expect(resultado.diferenca).toBe(-4_000);
    expect(resultado.percentualQueFecharia).toBeCloseTo(20, 10);
  });

  it("overhead cobrado é EXATAMENTE igual ao custo fixo real — diferença zero", () => {
    const resultado = calcularCoberturaOverhead(entradaBase({ overheadCobrado: 8_000, custoFixoPago: 8_000 }));

    expect(resultado.diferenca).toBe(0);
  });

  it("sem nenhum orçamento aprovado no período — tudo zero, sem dividir por zero", () => {
    const resultado = calcularCoberturaOverhead({
      overheadCobrado: 0,
      custoFixoPago: 0,
      custoDiretoAgregado: 0,
      receitaTotalAprovada: 0,
      receitaSemCustoDireto: 0,
    });

    expect(resultado.overheadCobrado).toBe(0);
    expect(resultado.custoFixoPago).toBe(0);
    expect(resultado.diferenca).toBe(0);
    expect(resultado.percentualQueFecharia).toBeNull();
    expect(resultado.percentualReceitaForaDoEscopo).toBeNull();
  });

  it("custoDiretoAgregado zero mas custo fixo pago > 0 (ex: aluguel pago sem nenhum orçamento aprovado no mês) — percentual indefinido, não Infinity/NaN", () => {
    const resultado = calcularCoberturaOverhead({
      overheadCobrado: 0,
      custoFixoPago: 3_000,
      custoDiretoAgregado: 0,
      receitaTotalAprovada: 0,
      receitaSemCustoDireto: 0,
    });

    expect(resultado.diferenca).toBe(3_000);
    expect(resultado.percentualQueFecharia).toBeNull();
  });

  it("achado N20 da Parte 9 — base é custoDireto, NUNCA receita bruta: cenário exato do achado (custo fixo R$30k, receita R$100k, custo direto R$40k) tem que dar 75%, não 30%", () => {
    const resultado = calcularCoberturaOverhead({
      overheadCobrado: 12_000,
      custoFixoPago: 30_000,
      custoDiretoAgregado: 40_000,
      receitaTotalAprovada: 100_000,
      receitaSemCustoDireto: 60_000,
    });

    // Bug original: 30.000 / 100.000 (receita) * 100 = 30% — errado.
    // Correto: 30.000 / 40.000 (custo direto) * 100 = 75%, a base que
    // compor.ts de fato usa pra aplicar overheadPercent.
    expect(resultado.percentualQueFecharia).toBeCloseTo(75, 10);
  });
});

// Achado N30 da Parte 9 da auditoria de código (2026-09-12) — item SIMPLES
// não tem custoDireto/overhead rastreado (não passa por comporPreco), então
// conta 0 em overheadCobrado/custoDiretoAgregado corretamente, mas isso
// enviesa percentualQueFecharia/diferenca em silêncio pra quem vende
// majoritariamente por SIMPLES: o relatório mede a cobertura de um
// mecanismo que essa gráfica mal usa, sem avisar em lugar nenhum.
describe("calcularCoberturaOverhead — achado N30: aviso de escopo (item SIMPLES fora da cobertura)", () => {
  it("100% da receita rastreada (nenhum SIMPLES): percentualReceitaForaDoEscopo é 0", () => {
    const resultado = calcularCoberturaOverhead(
      entradaBase({ receitaTotalAprovada: 40_000, receitaSemCustoDireto: 0 })
    );
    expect(resultado.percentualReceitaForaDoEscopo).toBe(0);
  });

  it("cenário da auditoria: gráfica vende majoritariamente por SIMPLES — percentualReceitaForaDoEscopo próximo de 100%", () => {
    // overheadCobrado=0, custoDiretoAgregado=0 (SIMPLES não passa pelo motor
    // avançado) — mas a gráfica de fato vendeu R$28.000 no período, quase
    // tudo por SIMPLES.
    const resultado = calcularCoberturaOverhead({
      overheadCobrado: 0,
      custoFixoPago: 28_000,
      custoDiretoAgregado: 0,
      receitaTotalAprovada: 28_000,
      receitaSemCustoDireto: 27_000, // R$1.000 vieram de um item M2 isolado
    });

    expect(resultado.percentualReceitaForaDoEscopo).toBeCloseTo((27_000 / 28_000) * 100, 6);
    expect(resultado.percentualReceitaForaDoEscopo).toBeGreaterThan(90);
  });

  it("sem receita aprovada nenhuma no período: percentualReceitaForaDoEscopo é null (nada a medir, não 0/0)", () => {
    const resultado = calcularCoberturaOverhead({
      overheadCobrado: 0,
      custoFixoPago: 0,
      custoDiretoAgregado: 0,
      receitaTotalAprovada: 0,
      receitaSemCustoDireto: 0,
    });
    expect(resultado.percentualReceitaForaDoEscopo).toBeNull();
  });
});
