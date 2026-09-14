import { describe, expect, it } from "vitest";
import { montarDadosParaFaixa, type ItemOrigemParaFaixa } from "./orcamento-faixas-quantidade";

// Achado B2 da auditoria do motor de preço (2026-09-13):
// tempoEstimadoMin/metrosCorte/horasEstimadas são um número ABSOLUTO
// digitado pro item ORIGINAL, não uma taxa por peça — antes desta correção,
// montarDadosParaFaixa reaproveitava esse valor cru pra QUALQUER quantidade
// de faixa, fazendo o motor cobrar o mesmo tempo de máquina pra 50 ou pra
// 200 peças.

function itemBase(overrides: Partial<ItemOrigemParaFaixa> = {}): ItemOrigemParaFaixa {
  return {
    larguraCm: null,
    alturaCm: null,
    corFrente: null,
    corVerso: null,
    numeroCoresFlexo: null,
    numeroCliques: null,
    numeroSetups: null,
    numeroPontos: null,
    tempoEstimadoMin: null,
    metrosCorte: null,
    horasEstimadas: null,
    custoAquisicaoUnitario: null,
    custoFaca: null,
    materialFornecidoPeloCliente: false,
    acabamentos: [],
    precificacaoEtiqueta: null,
    precificacaoDigital: null,
    precificacaoOffset: null,
    ...overrides,
  };
}

describe("montarDadosParaFaixa — achado B2: tempo/metros/horas escalam com a quantidade da faixa", () => {
  it("tempoEstimadoMin escala proporcionalmente (50→200 = ×4)", () => {
    const dados = montarDadosParaFaixa(itemBase({ tempoEstimadoMin: 200 }), 50, 200, null);
    expect(dados.tempoEstimadoMin).toBeCloseTo(800, 6);
  });

  it("metrosCorte escala proporcionalmente (50→25 = ×0,5)", () => {
    const dados = montarDadosParaFaixa(itemBase({ metrosCorte: 40 }), 50, 25, null);
    expect(dados.metrosCorte).toBeCloseTo(20, 6);
  });

  it("horasEstimadas escala proporcionalmente (10→30 = ×3)", () => {
    const dados = montarDadosParaFaixa(itemBase({ horasEstimadas: 2 }), 10, 30, null);
    expect(dados.horasEstimadas).toBeCloseTo(6, 6);
  });

  it("faixa com a MESMA quantidade do item original não muda nada (proporção = 1)", () => {
    const dados = montarDadosParaFaixa(
      itemBase({ tempoEstimadoMin: 200, metrosCorte: 40, horasEstimadas: 2 }),
      50,
      50,
      null
    );
    expect(dados.tempoEstimadoMin).toBeCloseTo(200, 6);
    expect(dados.metrosCorte).toBeCloseTo(40, 6);
    expect(dados.horasEstimadas).toBeCloseTo(2, 6);
  });

  it("null continua null (produto sem tempo/metros/horas configurado não ganha um valor do nada)", () => {
    const dados = montarDadosParaFaixa(itemBase(), 50, 200, null);
    expect(dados.tempoEstimadoMin).toBeNull();
    expect(dados.metrosCorte).toBeNull();
    expect(dados.horasEstimadas).toBeNull();
  });

  it("numeroPontos/numeroCliques/numeroSetups/custoFaca NÃO escalam — já são taxas por peça que o motor multiplica internamente", () => {
    const dados = montarDadosParaFaixa(
      itemBase({ numeroPontos: 8000, numeroCliques: 4, numeroSetups: 1, custoFaca: 15 }),
      50,
      200,
      null
    );
    expect(dados.numeroPontos).toBe(8000);
    expect(dados.numeroCliques).toBe(4);
    expect(dados.numeroSetups).toBe(1);
    expect(dados.custoFaca).toBe(15);
  });

  it("cenário exato da auditoria (achado B2): 50 peças/200min → faixa de 200 peças escala pra 800min", () => {
    const dados = montarDadosParaFaixa(itemBase({ tempoEstimadoMin: 200 }), 50, 200, null);
    expect(dados.tempoEstimadoMin).toBeCloseTo(800, 6);
  });
});
