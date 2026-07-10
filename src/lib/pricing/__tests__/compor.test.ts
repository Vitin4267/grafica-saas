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
  custoHoraMaq: 0,
  torres: 4,
  custoChapa: 0,
  folhasAcerto: 0,
  tempoAcertoH: 0,
  custoMilheiroRod: 0,
  rodagemMinima: 0,
  perdaPercentPadrao: 0,
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
});
