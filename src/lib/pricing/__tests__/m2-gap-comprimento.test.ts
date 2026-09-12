import { describe, expect, it } from "vitest";
import { calcularM2 } from "../m2";
import type { ContextoM2, PedidoM2 } from "../tipos";

// Achado 7 da auditoria do motor M2/Offset (2026-09-12) — teste isolado,
// direto em calcularM2 (função pura, sem passar por precificar/compor),
// provando que a correção do gap no eixo do COMPRIMENTO (lConsumido) some
// exatamente 1 gap em relação à fórmula antiga, não importa numFaixas.
//
// ANTES: lConsumido = numFaixas × (b+g)  → cobra numFaixas gaps.
// AGORA: lConsumido = numFaixas × b + (numFaixas−1) × g → cobra numFaixas−1
// gaps — a convenção "n−1 gaps" correta pra n peças enfileiradas (só existe
// vão ENTRE peças vizinhas, nunca depois da última). A diferença entre as
// duas fórmulas é sempre exatamente g, qualquer que seja numFaixas:
//   numFaixas×(b+g) − [numFaixas×b + (numFaixas−1)×g]
//     = numFaixas×b + numFaixas×g − numFaixas×b − numFaixas×g + g
//     = g
describe("achado 7 — lConsumido usa n−1 gaps no eixo do comprimento (não n gaps)", () => {
  it("compara a fórmula antiga (numFaixas×(b+g)) com a nova (n−1 gaps): diferença de exatamente 1 gap", () => {
    const bobina = { id: "bobina-0.20", larguraNominal: 0.2, refile: 0 };
    const contexto: ContextoM2 = {
      bobinas: [bobina],
      custoM2Material: 10,
      custoImpressaoM2: 5,
      areaMinimaFaturavel: 0,
    };

    // margemSeguranca=0 pra isolar só o efeito do gap no eixo do
    // comprimento, sem a margem de segurança misturando as contas.
    const pedido: PedidoM2 = {
      larguraM: 0.15,
      alturaM: 0.05,
      quantidade: 5,
      margemSeguranca: 0,
      gapPecas: 0.01,
    };
    const defaults = { margemSegurancaPadrao: 0.02, gapPecasPadrao: 0.008 };

    const resultado = calcularM2(pedido, contexto, defaults);

    // wUtil = 0,2 (refile=0); orientação sem rotação: a=w'=0,15, b=h'=0,05.
    // pecasPorFaixa = floor((wUtil+g)/(a+g)) = floor((0,2+0,01)/(0,15+0,01))
    //               = floor(0,21/0,16) = floor(1,3125) = 1
    // numFaixas = ceil(Q/pecasPorFaixa) = ceil(5/1) = 5
    expect(resultado.pecasPorFaixa).toBe(1);
    expect(resultado.numFaixas).toBe(5);

    // lConsumido NOVO (n−1 gaps) = numFaixas×b + (numFaixas−1)×g
    //   = 5×0,05 + 4×0,01 = 0,25 + 0,04 = 0,29
    // areaFaturavel = larguraNominal × lConsumido = 0,2 × 0,29 = 0,058
    const areaFaturavelNova = resultado.areaFaturavel.toNumber();
    expect(areaFaturavelNova).toBeCloseTo(0.058, 6);

    // lConsumido ANTIGO (bug, n gaps) = numFaixas×(b+g) = 5×(0,05+0,01)
    //   = 5×0,06 = 0,30
    // areaFaturavel ANTIGA = 0,2×0,30 = 0,06
    const lConsumidoAntigo = 5 * (0.05 + 0.01);
    const areaFaturavelAntiga = 0.2 * lConsumidoAntigo;
    expect(areaFaturavelAntiga).toBeCloseTo(0.06, 6);

    // A diferença entre as duas é exatamente larguraNominal × 1 gap
    // (0,2 × 0,01 = 0,002) — nunca numFaixas × gap, mesmo com numFaixas=5.
    expect(areaFaturavelAntiga - areaFaturavelNova).toBeCloseTo(0.2 * 0.01, 6);

    // E em termos de comprimento consumido (sem o fator largura), a
    // diferença é exatamente 1 gap: 0,30 − 0,29 = 0,01 = g.
    const lConsumidoNovo = areaFaturavelNova / 0.2;
    expect(lConsumidoAntigo - lConsumidoNovo).toBeCloseTo(0.01, 6);
  });
});
