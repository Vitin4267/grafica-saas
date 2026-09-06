import { describe, it, expect } from "vitest";
import { calcularCustoAquisicaoTotal } from "./custo-aquisicao-compra";

// Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
// função PURA (sem I/O), testada isoladamente do fluxo de status de compra
// (ver testes de integração em src/app/compras/custo-aquisicao.test.ts pro
// caminho completo via avancarStatusCompra).
describe("calcularCustoAquisicaoTotal", () => {
  it("compatibilidade: sem nenhum dos 4 componentes, resultado é EXATAMENTE valorFinal", () => {
    const resultado = calcularCustoAquisicaoTotal(350, null, null, null, null);
    expect(resultado.toNumber()).toBe(350);
  });

  it("compatibilidade: undefined tem o mesmo efeito de null", () => {
    const resultado = calcularCustoAquisicaoTotal(350, undefined, undefined, undefined, undefined);
    expect(resultado.toNumber()).toBe(350);
  });

  it("frete e IPI aumentam o custo de aquisição", () => {
    const resultado = calcularCustoAquisicaoTotal(1000, 100, 50, null, null);
    expect(resultado.toNumber()).toBe(1150);
  });

  it("ICMS creditável e desconto reduzem o custo de aquisição", () => {
    const resultado = calcularCustoAquisicaoTotal(1000, null, null, 80, 20);
    expect(resultado.toNumber()).toBe(900);
  });

  it("combina os 4 componentes ao mesmo tempo (caso do achado: R$400 de frete numa compra de R$8.000)", () => {
    // valorFinal 8000 + frete 400 + IPI 160 - ICMS 120 - desconto 50 = 8390
    const resultado = calcularCustoAquisicaoTotal(8000, 400, 160, 120, 50);
    expect(resultado.toNumber()).toBe(8390);
  });

  it("aceita valores em formato string (como vem de FormData) e Decimal-like (toString)", () => {
    const decimalLike = { toString: () => "50" };
    const resultado = calcularCustoAquisicaoTotal("1000", "100", decimalLike, null, null);
    expect(resultado.toNumber()).toBe(1150);
  });
});
