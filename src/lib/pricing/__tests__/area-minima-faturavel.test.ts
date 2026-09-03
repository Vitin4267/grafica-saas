import { describe, expect, it } from "vitest";
import { calcularM2 } from "../m2";
import type { ContextoM2, PedidoM2 } from "../tipos";

// Achado N18 da auditoria de abrangência — ConfiguracaoProduto.areaMinimaFaturavel
// (M2) era só uma métrica de auditoria/exibição, nunca realimentava o custo:
// "cobro no mínimo 1m² por peça de adesivo recortado" não era representável.
// Agora entra em custoImpressao (que sempre escalou com a área com margem de
// segurança — mesma base wLinha×hLinha de sempre) via areaImpressaoPorPeca,
// floored pela área mínima configurada.

const BOBINA = { id: "bobina-1.00", larguraNominal: 1.0, refile: 0.02 };
const DEFAULTS = { margemSegurancaPadrao: 0.02, gapPecasPadrao: 0.008 };

function contexto(areaMinimaFaturavel: number): ContextoM2 {
  return {
    bobinas: [BOBINA],
    custoM2Material: 10,
    custoImpressaoM2: 5,
    areaMinimaFaturavel,
  };
}

function pedido(larguraM: number, alturaM: number, quantidade: number): PedidoM2 {
  return { larguraM, alturaM, quantidade };
}

describe("achado N18 — área mínima faturável entra no custoBase (M2)", () => {
  it("peça menor que a área mínima é cobrada como se tivesse a área mínima (custoImpressao sobe)", () => {
    // Peça de 5×5cm = 0,0025m² nominal; com margem de segurança padrão
    // (0,02 por lado) fica 0,09×0,09 = 0,0081m² — ainda bem menor que o piso
    // de 1m² configurado abaixo.
    const semPiso = calcularM2(pedido(0.05, 0.05, 1), contexto(0), DEFAULTS);
    const comPiso = calcularM2(pedido(0.05, 0.05, 1), contexto(1), DEFAULTS);

    // custoImpressao = Q × areaImpressaoPorPeca × custoImpressaoM2. Sem piso:
    // 1 × 0,0081 × 5 = 0,0405. Com piso de 1m²: 1 × 1 × 5 = 5.
    expect(semPiso.custoImpressao.toNumber()).toBeCloseTo(0.0405, 4);
    expect(comPiso.custoImpressao.toNumber()).toBeCloseTo(5, 4);
    expect(comPiso.custoBase.toNumber()).toBeGreaterThan(semPiso.custoBase.toNumber());
  });

  it("escala com a quantidade — cada peça abaixo do mínimo paga o piso, não só a primeira", () => {
    const resultado = calcularM2(pedido(0.05, 0.05, 10), contexto(1), DEFAULTS);
    // 10 peças × 1m² × R$5/m² = R$50 de impressão.
    expect(resultado.custoImpressao.toNumber()).toBeCloseTo(50, 4);
  });

  it("peça maior que a área mínima não é afetada (comportamento de sempre, sem regressão)", () => {
    // Peça de 0,8×0,8m (cabe na bobina de 1,00m) — bem acima de qualquer
    // piso plausível (0,1m² aqui).
    const semPiso = calcularM2(pedido(0.8, 0.8, 1), contexto(0), DEFAULTS);
    const comPisoBaixo = calcularM2(pedido(0.8, 0.8, 1), contexto(0.1), DEFAULTS);

    expect(comPisoBaixo.custoImpressao.toNumber()).toBeCloseTo(semPiso.custoImpressao.toNumber(), 6);
  });

  it("areaMinimaFaturavel=0 (padrão, produto sem piso configurado) nunca altera o custo", () => {
    const resultado = calcularM2(pedido(0.05, 0.05, 1), contexto(0), DEFAULTS);
    const areaComMargem = (0.05 + 2 * 0.02) * (0.05 + 2 * 0.02);
    expect(resultado.custoImpressao.toNumber()).toBeCloseTo(areaComMargem * 5, 6);
  });

  it("areaCobrada (métrica de exibição) continua na base nominal w×h, sem margem — não confundir com o custo", () => {
    const resultado = calcularM2(pedido(0.05, 0.05, 10), contexto(1), DEFAULTS);
    // 10 × max(0,0025, 1) = 10m² — base NOMINAL (sem margem de segurança),
    // deliberadamente diferente da base usada em custoImpressao acima.
    expect(resultado.areaCobrada.toNumber()).toBeCloseTo(10, 6);
  });
});
