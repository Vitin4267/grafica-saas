import { describe, it, expect } from "vitest";
import { montarDRE, type EntradaDRE } from "@/lib/dre";

// Teste UNITÁRIO (função pura, sem banco) — achado A3 da Parte 4 da
// auditoria de abrangência (pesquisa-abrangencia-modulos.md, 2026-09-05).

function entradaBase(overrides: Partial<EntradaDRE> = {}): EntradaDRE {
  return {
    receitaBruta: 100_000,
    impostos: 6_000, // 6% — default de ParametrosGrafica.impostoPercent
    descontos: 0,
    custosVariaveis: 40_000,
    custoFixo: 30_000,
    comissoes: 5_000,
    despesasFinanceiras: 0,
    ...overrides,
  };
}

describe("montarDRE — caso concreto com margem positiva", () => {
  it("calcula receita líquida, MC%, resultado operacional/líquido e ponto de equilíbrio", () => {
    const resultado = montarDRE(entradaBase());

    // Receita líquida = 100.000 - 6.000 - 0 = 94.000
    expect(resultado.receitaLiquida).toBe(94_000);
    // Margem de contribuição = 94.000 - 40.000 = 54.000
    expect(resultado.margemContribuicao).toBe(54_000);
    // MC% = 54.000 / 94.000 ≈ 0,574468...
    expect(resultado.margemContribuicaoPercent).toBeCloseTo(54_000 / 94_000, 10);
    // Resultado operacional = 54.000 - 30.000 - 5.000 = 19.000
    expect(resultado.resultadoOperacional).toBe(19_000);
    // Resultado líquido = 19.000 - 0 = 19.000
    expect(resultado.resultadoLiquido).toBe(19_000);
    // Ponto de equilíbrio = 30.000 / (54.000/94.000) = 52.222,22...
    expect(resultado.pontoEquilibrio).toBeCloseTo(30_000 / (54_000 / 94_000), 6);
  });

  it("marca cada linha com o regime correto (CAIXA/COMPETENCIA/MISTO explícito)", () => {
    const resultado = montarDRE(entradaBase());
    const porRotulo = new Map(resultado.linhas.map((l) => [l.rotulo, l]));

    expect(porRotulo.get("Receita bruta")?.regime).toBe("COMPETENCIA");
    expect(porRotulo.get("(−) Impostos (estimado)")?.regime).toBe("COMPETENCIA");
    expect(porRotulo.get("(−) Descontos")?.regime).toBe("COMPETENCIA");
    expect(porRotulo.get("= Receita líquida")?.regime).toBe("COMPETENCIA");
    expect(porRotulo.get("(−) Custos variáveis")?.regime).toBe("COMPETENCIA");
    expect(porRotulo.get("= Margem de contribuição")?.regime).toBe("COMPETENCIA");

    expect(porRotulo.get("(−) Custo fixo (pago)")?.regime).toBe("CAIXA");
    expect(porRotulo.get("(−) Comissões (pagas)")?.regime).toBe("CAIXA");
    expect(porRotulo.get("(−) Despesas financeiras (pagas)")?.regime).toBe("CAIXA");

    // Resultado operacional/líquido misturam competência (margem) com caixa
    // (custo fixo/comissão pagos) DE PROPÓSITO — o ponto do achado A3 é
    // rotular a mistura, não eliminá-la.
    const operacional = porRotulo.get("= Resultado operacional");
    expect(operacional?.regime).toBe("MISTO");
    expect(operacional?.detalheRegime).toBeTruthy();
    const liquido = porRotulo.get("= Resultado líquido");
    expect(liquido?.regime).toBe("MISTO");
    expect(liquido?.detalheRegime).toBeTruthy();
  });

  it("todo valor negativo (linhas de dedução) tem sinal negativo, mesmo com entrada positiva", () => {
    const resultado = montarDRE(entradaBase());
    const porRotulo = new Map(resultado.linhas.map((l) => [l.rotulo, l]));

    expect(porRotulo.get("(−) Impostos (estimado)")?.valor).toBe(-6_000);
    expect(porRotulo.get("(−) Custos variáveis")?.valor).toBe(-40_000);
    expect(porRotulo.get("(−) Custo fixo (pago)")?.valor).toBe(-30_000);
    expect(porRotulo.get("(−) Comissões (pagas)")?.valor).toBe(-5_000);
  });
});

describe("montarDRE — casos de borda", () => {
  it("receitaBruta zero (gráfica sem nenhum orçamento aprovado no período) não divide por zero", () => {
    const resultado = montarDRE(
      entradaBase({ receitaBruta: 0, impostos: 0, descontos: 0, custosVariaveis: 0 })
    );

    expect(resultado.receitaLiquida).toBe(0);
    expect(resultado.margemContribuicao).toBe(0);
    expect(resultado.margemContribuicaoPercent).toBeNull();
    expect(resultado.pontoEquilibrio).toBeNull();
    // Custo fixo/comissão continuam sendo pagos mesmo sem faturar —
    // resultado fica negativo, não zerado/escondido.
    expect(resultado.resultadoOperacional).toBe(-35_000);
    expect(resultado.resultadoLiquido).toBe(-35_000);
  });

  it("margem de contribuição negativa (custo variável maior que receita líquida) não gera ponto de equilíbrio", () => {
    const resultado = montarDRE(
      entradaBase({ receitaBruta: 50_000, impostos: 3_000, descontos: 0, custosVariaveis: 60_000 })
    );

    // Receita líquida = 47.000; MC = 47.000 - 60.000 = -13.000
    expect(resultado.margemContribuicao).toBe(-13_000);
    expect(resultado.margemContribuicaoPercent).toBeLessThan(0);
    // %MC negativo: nenhum volume de venda fecha a conta — null, não um
    // número negativo (que pareceria "ponto de equilíbrio" e enganaria o
    // dono da gráfica lendo o relatório).
    expect(resultado.pontoEquilibrio).toBeNull();
  });

  it("margem de contribuição exatamente zero também não gera ponto de equilíbrio (divisão por zero)", () => {
    const resultado = montarDRE(
      entradaBase({ receitaBruta: 40_000, impostos: 0, descontos: 0, custosVariaveis: 40_000 })
    );

    expect(resultado.margemContribuicao).toBe(0);
    expect(resultado.margemContribuicaoPercent).toBe(0);
    expect(resultado.pontoEquilibrio).toBeNull();
  });

  it("descontos e impostos juntos reduzem a receita líquida corretamente", () => {
    const resultado = montarDRE(
      entradaBase({ receitaBruta: 100_000, impostos: 6_000, descontos: 4_000, custosVariaveis: 40_000 })
    );

    expect(resultado.receitaLiquida).toBe(90_000);
    expect(resultado.margemContribuicao).toBe(50_000);
  });

  it("despesas financeiras (hoje sempre 0 na origem real) reduzem o resultado líquido quando informadas", () => {
    const semFinanceira = montarDRE(entradaBase());
    const comFinanceira = montarDRE(entradaBase({ despesasFinanceiras: 2_000 }));

    expect(comFinanceira.resultadoOperacional).toBe(semFinanceira.resultadoOperacional);
    expect(comFinanceira.resultadoLiquido).toBe(semFinanceira.resultadoLiquido - 2_000);
  });
});
