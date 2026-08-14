import { describe, it, expect } from "vitest";
import {
  UNIDADES_DIMENSAO,
  ROTULO_UNIDADE_DIMENSAO,
  converterParaCm,
  converterDeCm,
  passoInputDimensao,
} from "./unidade-dimensao";

describe("converterParaCm", () => {
  it("mm para cm", () => {
    expect(converterParaCm(35, "MM")).toBe(3.5);
    expect(converterParaCm(3, "MM")).toBe(0.3);
  });

  it("cm para cm é identidade", () => {
    expect(converterParaCm(12.34, "CM")).toBe(12.34);
  });

  it("m para cm", () => {
    expect(converterParaCm(1, "M")).toBe(100);
    expect(converterParaCm(0.5, "M")).toBe(50);
    expect(converterParaCm(1.25, "M")).toBe(125);
  });

  it("não sofre erro clássico de ponto flutuante binário", () => {
    // 0.1 * 100 em ponto flutuante binário puro (`0.1 * 100`) dá
    // 10.000000000000002 — aqui tem que dar exatamente 10.
    expect(converterParaCm(0.1, "M")).toBe(10);
    // 2.9 / 10 em binário puro (`2.9 / 10`) dá 0.29000000000000004
    expect(converterParaCm(2.9, "MM")).toBe(0.29);
  });

  it("arredonda pra 2 casas decimais (precisão da coluna no banco)", () => {
    // 0.333mm -> 0.0333cm, arredonda pra 0.03cm
    expect(converterParaCm(0.333, "MM")).toBe(0.03);
  });

  it("zero é convertido normalmente (sem validação de sinal)", () => {
    expect(converterParaCm(0, "MM")).toBe(0);
    expect(converterParaCm(0, "CM")).toBe(0);
    expect(converterParaCm(0, "M")).toBe(0);
  });

  it("negativo é convertido normalmente (validação de sinal é do chamador)", () => {
    expect(converterParaCm(-5, "CM")).toBe(-5);
    expect(converterParaCm(-10, "MM")).toBe(-1);
    expect(converterParaCm(-0.5, "M")).toBe(-50);
  });
});

describe("converterDeCm", () => {
  it("cm para mm", () => {
    expect(converterDeCm(3.5, "MM")).toBe(35);
    expect(converterDeCm(0.3, "MM")).toBe(3);
  });

  it("cm para cm é identidade", () => {
    expect(converterDeCm(12.34, "CM")).toBe(12.34);
  });

  it("cm para m", () => {
    expect(converterDeCm(100, "M")).toBe(1);
    expect(converterDeCm(50, "M")).toBe(0.5);
    expect(converterDeCm(125, "M")).toBe(1.25);
  });

  it("zero é convertido normalmente", () => {
    expect(converterDeCm(0, "MM")).toBe(0);
    expect(converterDeCm(0, "M")).toBe(0);
  });

  it("negativo é convertido normalmente", () => {
    expect(converterDeCm(-50, "M")).toBe(-0.5);
  });
});

describe("ida e volta (round-trip) sem perder valor", () => {
  it.each([
    ["MM", 35] as const,
    ["MM", 1] as const,
    ["CM", 12.34] as const,
    ["CM", 0.5] as const,
    ["M", 0.5] as const,
    ["M", 1.25] as const,
    ["M", 3] as const,
  ])("unidade=%s valor=%s", (unidade, valorOriginal) => {
    const cm = converterParaCm(valorOriginal, unidade);
    const deVolta = converterDeCm(cm, unidade);
    expect(deVolta).toBe(valorOriginal);
  });

  it("valor com decimal fino em metros (0,5m) mantém precisão", () => {
    const cm = converterParaCm(0.5, "M");
    expect(cm).toBe(50);
    expect(converterDeCm(cm, "M")).toBe(0.5);
  });
});

describe("UNIDADES_DIMENSAO e ROTULO_UNIDADE_DIMENSAO", () => {
  it("toda unidade tem rótulo", () => {
    for (const unidade of UNIDADES_DIMENSAO) {
      expect(ROTULO_UNIDADE_DIMENSAO[unidade]).toBeTruthy();
    }
  });

  it("rótulos esperados", () => {
    expect(ROTULO_UNIDADE_DIMENSAO.MM).toBe("mm");
    expect(ROTULO_UNIDADE_DIMENSAO.CM).toBe("cm");
    expect(ROTULO_UNIDADE_DIMENSAO.M).toBe("m");
  });
});

describe("passoInputDimensao", () => {
  it("mm é inteiro", () => {
    expect(passoInputDimensao("MM")).toBe("1");
  });

  it("cm e m aceitam casas decimais", () => {
    expect(passoInputDimensao("CM")).toBe("0.1");
    expect(passoInputDimensao("M")).toBe("0.01");
  });
});
