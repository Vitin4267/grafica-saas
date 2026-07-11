import { describe, it, expect } from "vitest";
import { D } from "@/lib/pricing/decimal";
import { calcularNovoPreco } from "./catalogo-reajuste";

const incremento10c = new D("0.10");

describe("calcularNovoPreco", () => {
  it("aumento de 10% num preço redondo", () => {
    const resultado = calcularNovoPreco(new D("100.00"), 10, incremento10c);
    expect(resultado.toString()).toBe("110");
  });

  it("redução de 20% num preço redondo", () => {
    const resultado = calcularNovoPreco(new D("100.00"), -20, incremento10c);
    expect(resultado.toString()).toBe("80");
  });

  it("limite de -90%", () => {
    const resultado = calcularNovoPreco(new D("100.00"), -90, incremento10c);
    expect(resultado.toString()).toBe("10");
  });

  it("limite de +500%", () => {
    const resultado = calcularNovoPreco(new D("10.00"), 500, incremento10c);
    expect(resultado.toString()).toBe("60");
  });

  it("arredondamento pra cima pode fazer uma redução pequena virar aumento — caso de UX documentado", () => {
    // R$0,15 a -20% dá R$0,12 — arredondando pra cima no incremento de
    // R$0,10, vira R$0,20 (aumento, não redução). Esperado, não é bug: a
    // tela de confirmação sempre mostra antes/depois por causa disso.
    const resultado = calcularNovoPreco(new D("0.15"), -20, incremento10c);
    expect(resultado.toString()).toBe("0.2");
    expect(resultado.greaterThan(new D("0.15"))).toBe(true);
  });

  it("sem incremento de arredondamento configurado (0), não arredonda", () => {
    const resultado = calcularNovoPreco(new D("33.33"), 10, new D(0));
    expect(resultado.toString()).toBe("36.663");
  });

  it("percentual zero mantém o preço (só passa pelo arredondamento)", () => {
    const resultado = calcularNovoPreco(new D("47.30"), 0, incremento10c);
    expect(resultado.toString()).toBe("47.3");
  });
});
