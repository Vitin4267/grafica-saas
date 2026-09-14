import { describe, expect, it } from "vitest";
import { calcularM2 } from "../m2";
import type { ContextoM2, PedidoM2 } from "../tipos";

// Achado A8 da auditoria de abrangência (2026-09-14) — M2 era o único motor
// de precificação sem desconto de perda de material (OFFSET/FLEXOGRAFIA já
// descontam, ver __tests__/offset.test.ts e flexografia.test.ts). Este
// arquivo prova só o efeito da perda no CUSTO — mesmo espírito de
// m2-gap-comprimento.test.ts (função pura, sem passar por precificar/compor,
// conta manual com toBeCloseTo).

function pedidoValido(overrides: Partial<PedidoM2> = {}): PedidoM2 {
  return {
    larguraM: 0.2,
    alturaM: 0.1,
    quantidade: 10,
    margemSeguranca: 0,
    gapPecas: 0,
    ...overrides,
  };
}

function contextoValido(overrides: Partial<ContextoM2> = {}): ContextoM2 {
  return {
    bobinas: [{ id: "bobina-1.00", larguraNominal: 1.0, refile: 0 }],
    custoM2Material: 10,
    custoImpressaoM2: 5,
    areaMinimaFaturavel: 0,
    ...overrides,
  };
}

describe("calcularM2 — achado A8: perda de material infla custoMaterial, nunca a área de exibição", () => {
  it("perdaPercent=0 (default) calcula exatamente igual a antes do achado", () => {
    const resultado = calcularM2(pedidoValido(), contextoValido(), {
      margemSegurancaPadrao: 0,
      gapPecasPadrao: 0,
    });

    // wUtil=1,0; a=w=0,2; pecasPorFaixa = floor(1,0/0,2) = 5;
    // numFaixas = ceil(10/5) = 2; lConsumido = 2×0,1 + 1×0 = 0,2
    // areaFaturavel = 1,0×0,2 = 0,2; custoMaterial = 0,2×10 = 2 (perda 0%)
    expect(resultado.areaFaturavel.toNumber()).toBeCloseTo(0.2, 6);
    expect(resultado.custoMaterial.toNumber()).toBeCloseTo(2, 6);
  });

  it("perdaPercent=0.1 (10%, override no pedido) infla custoMaterial em exatamente 10% — areaFaturavel retornado NÃO muda", () => {
    const resultado = calcularM2(pedidoValido({ perdaPercent: 0.1 }), contextoValido(), {
      margemSegurancaPadrao: 0,
      gapPecasPadrao: 0,
    });

    // Mesmo nesting de antes (perda não afeta escolha de bobina/orientação,
    // só o custo) — areaFaturavel retornado continua nominal, 0,2.
    expect(resultado.areaFaturavel.toNumber()).toBeCloseTo(0.2, 6);
    // custoMaterial = areaFaturavel × (1+perda) × custoM2Material
    //               = 0,2 × 1,1 × 10 = 2,2
    expect(resultado.custoMaterial.toNumber()).toBeCloseTo(2.2, 6);
  });

  it("default do tenant (perdaPercentPadraoM2) é usado quando o pedido não informa perdaPercent", () => {
    const semDefault = calcularM2(pedidoValido(), contextoValido(), {
      margemSegurancaPadrao: 0,
      gapPecasPadrao: 0,
      perdaPercentPadraoM2: 0,
    });
    const comDefault = calcularM2(pedidoValido(), contextoValido(), {
      margemSegurancaPadrao: 0,
      gapPecasPadrao: 0,
      perdaPercentPadraoM2: 0.05,
    });

    expect(semDefault.custoMaterial.toNumber()).toBeCloseTo(2, 6);
    // 0,2 × 1,05 × 10 = 2,1
    expect(comDefault.custoMaterial.toNumber()).toBeCloseTo(2.1, 6);
  });

  it("perdaPercent no PEDIDO sobrepõe o default do tenant (mesma regra de OFFSET/FLEXOGRAFIA)", () => {
    const resultado = calcularM2(pedidoValido({ perdaPercent: 0.2 }), contextoValido(), {
      margemSegurancaPadrao: 0,
      gapPecasPadrao: 0,
      perdaPercentPadraoM2: 0.05, // ignorado — pedido tem prioridade
    });

    // 0,2 × 1,2 × 10 = 2,4
    expect(resultado.custoMaterial.toNumber()).toBeCloseTo(2.4, 6);
  });

  it("perda não muda qual bobina é escolhida (multiplica todos os candidatos pelo mesmo fator)", () => {
    const contexto = contextoValido({
      bobinas: [
        { id: "estreita-0.50", larguraNominal: 0.5, refile: 0 },
        { id: "larga-2.00", larguraNominal: 2.0, refile: 0 },
      ],
    });

    const semPerda = calcularM2(pedidoValido(), contexto, {
      margemSegurancaPadrao: 0,
      gapPecasPadrao: 0,
    });
    const comPerda = calcularM2(pedidoValido({ perdaPercent: 0.15 }), contexto, {
      margemSegurancaPadrao: 0,
      gapPecasPadrao: 0,
    });

    expect(comPerda.bobinaEscolhida.id).toBe(semPerda.bobinaEscolhida.id);
    expect(comPerda.custoMaterial.toNumber()).toBeCloseTo(
      semPerda.custoMaterial.toNumber() * 1.15,
      6
    );
  });

  it("perdaPercent inválido (fora de [0,1]) lança PERDA_INVALIDA (validarPedidoM2 roda dentro de calcularM2)", () => {
    expect(() =>
      calcularM2(pedidoValido({ perdaPercent: 3 }), contextoValido(), {
        margemSegurancaPadrao: 0,
        gapPecasPadrao: 0,
      })
    ).toThrow();
  });
});
