import { describe, it, expect } from "vitest";
import { calcularAliquotaEfetivaSimples, FAIXAS_ANEXO_III } from "./simples-nacional";

describe("calcularAliquotaEfetivaSimples", () => {
  it("RBT12 na 1ª faixa: alíquota efetiva == alíquota nominal (parcela dedutível zero)", () => {
    const resultado = calcularAliquotaEfetivaSimples(100_000);
    expect(resultado.faixaIndice).toBe(0);
    expect(resultado.aliquotaNominal).toBeCloseTo(0.06, 6);
    expect(resultado.aliquotaEfetiva).toBeCloseTo(0.06, 6);
  });

  it("RBT12 == 0 (gráfica nova, sem faturamento apurado): cai na 1ª faixa sem dividir por zero", () => {
    const resultado = calcularAliquotaEfetivaSimples(0);
    expect(resultado.faixaIndice).toBe(0);
    expect(resultado.aliquotaEfetiva).toBeCloseTo(0.06, 6);
    expect(Number.isFinite(resultado.aliquotaEfetiva)).toBe(true);
  });

  it("RBT12 na 2ª faixa (R$250.000): aplica a fórmula (RBT12×Aliq−PD)÷RBT12 corretamente", () => {
    // (250000 * 0.112 - 9360) / 250000 = (28000 - 9360) / 250000 = 0.07456
    const resultado = calcularAliquotaEfetivaSimples(250_000);
    expect(resultado.faixaIndice).toBe(1);
    expect(resultado.aliquotaNominal).toBeCloseTo(0.112, 6);
    expect(resultado.parcelaDedutivel).toBe(9_360);
    expect(resultado.aliquotaEfetiva).toBeCloseTo(0.07456, 6);
  });

  it("RBT12 na 3ª faixa (R$500.000): efetiva sobe pra ~10%, bem acima do default de 6%", () => {
    // (500000 * 0.135 - 17640) / 500000 = (67500 - 17640) / 500000 = 0.09972
    const resultado = calcularAliquotaEfetivaSimples(500_000);
    expect(resultado.faixaIndice).toBe(2);
    expect(resultado.aliquotaEfetiva).toBeCloseTo(0.09972, 6);
    expect(resultado.aliquotaEfetiva).toBeGreaterThan(0.06);
  });

  it("RBT12 acima do teto do Anexo III (desenquadramento): usa a última faixa como aproximação, não quebra", () => {
    const resultado = calcularAliquotaEfetivaSimples(10_000_000);
    expect(resultado.faixaIndice).toBe(FAIXAS_ANEXO_III.length - 1);
    expect(Number.isFinite(resultado.aliquotaEfetiva)).toBe(true);
  });

  it("faixa exatamente no teto (R$180.000) ainda conta como 1ª faixa (limite inclusive)", () => {
    const resultado = calcularAliquotaEfetivaSimples(180_000);
    expect(resultado.faixaIndice).toBe(0);
  });
});
