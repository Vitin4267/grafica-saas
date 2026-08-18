import { describe, expect, it } from "vitest";
import { comporPreco } from "../compor";
import { paraDecimal } from "../decimal";
import { ErroPrecificacao } from "../erros";
import type { ParametrosTenant } from "../tipos";

const PARAMS: ParametrosTenant = {
  overheadPercent: 0.15,
  margemPadrao: 0.2,
  impostoPercent: 0.06,
  comissaoPercent: 0,
  taxaFinanceiraPercent: 0,
  pedidoMinimo: 0,
  incrementoArredondamento: 0.1,
  margemSegurancaPadrao: 0.02,
  gapPecasPadrao: 0.008,
};

describe("comporPreco", () => {
  it("margem é aplicada por divisor, não por multiplicador", () => {
    const resultado = comporPreco({
      quantidade: 1,
      custoBase: paraDecimal(100),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0.2, impostoPercent: 0 },
    });
    // custoDireto=100, custoTotal=100, precoBruto = 100/(1-0.2) = 125, não 100*1.2=120
    expect(resultado.precoFinal.toNumber()).toBeCloseTo(125, 5);
  });

  it("rejeita configuração com soma de encargos >= 0.85", () => {
    expect(() =>
      comporPreco({
        quantidade: 1,
        custoBase: paraDecimal(100),
        parametros: { ...PARAMS, margemPadrao: 0.5, impostoPercent: 0.4 },
      })
    ).toThrow(ErroPrecificacao);
  });

  it("arredonda o preço final para cima no incremento comercial configurado", () => {
    const resultado = comporPreco({
      quantidade: 1,
      custoBase: paraDecimal(100),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0, impostoPercent: 0, incrementoArredondamento: 5 },
    });
    // custoDireto=100, sem encargos => precoBruto=100, arredonda pra cima em múltiplos de 5 => 100
    expect(resultado.precoFinal.toNumber()).toBe(100);
  });

  it("aplica o piso de pedidoMinimo quando o preço calculado é menor", () => {
    const resultado = comporPreco({
      quantidade: 1,
      custoBase: paraDecimal(1),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0, impostoPercent: 0, pedidoMinimo: 50 },
    });
    expect(resultado.precoFinal.toNumber()).toBe(50);
  });

  it("precoUnitario × quantidade bate com precoFinal mesmo quando a divisão não fecha redondo (evita item.precoUnitario × item.quantidade ≠ item.precoTotal depois de gravar em Decimal(12,2))", () => {
    const resultado = comporPreco({
      quantidade: 7,
      custoBase: paraDecimal(10),
      parametros: PARAMS,
    });

    // precoUnitario já deve sair arredondado pra 2 casas (fonte da verdade),
    // e precoFinal deve ser o unitário × quantidade — não uma divisão à parte.
    expect(resultado.precoUnitario.toNumber()).toBe(2.23);
    expect(resultado.precoFinal.toNumber()).toBe(15.61);

    // Simula o que o Postgres faz ao gravar cada coluna Decimal(12,2)
    // independentemente: arredonda as duas pra 2 casas e confere que ainda batem.
    const unitarioGravado = Number(resultado.precoUnitario.toFixed(2));
    const totalGravado = Number(resultado.precoFinal.toFixed(2));
    expect(Math.round(unitarioGravado * 7 * 100) / 100).toBe(totalGravado);
  });

  it("custoCliche e custoFaca somam em custoDireto uma única vez, sem escalar com a quantidade", () => {
    const semExtras = comporPreco({
      quantidade: 1000,
      custoBase: paraDecimal(100),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0, impostoPercent: 0 },
    });
    const comExtras = comporPreco({
      quantidade: 1000,
      custoBase: paraDecimal(100),
      custoCliche: paraDecimal(40), // ex: 4 cores × R$10/clichê
      custoFaca: paraDecimal(60),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0, impostoPercent: 0 },
    });

    // custoDireto sobe exatamente 40+60=100, não 100×1000 (não escala com Q).
    expect(comExtras.custoDireto.toNumber()).toBe(semExtras.custoDireto.toNumber() + 100);
    expect(comExtras.detalhes.cliche.toNumber()).toBe(40);
    expect(comExtras.detalhes.faca.toNumber()).toBe(60);

    // Sem os params, os detalhes vêm zerados (nunca undefined) — mantém o
    // shape do breakdown estável entre orçamentos com e sem etiqueta.
    expect(semExtras.detalhes.cliche.toNumber()).toBe(0);
    expect(semExtras.detalhes.faca.toNumber()).toBe(0);
  });
});
