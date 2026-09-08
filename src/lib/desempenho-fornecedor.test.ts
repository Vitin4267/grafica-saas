import { describe, it, expect } from "vitest";
import {
  calcularDesempenhoFornecedores,
  AMOSTRA_MINIMA_DESEMPENHO,
  type CompraParaDesempenho,
} from "./desempenho-fornecedor";

function compra(parcial: Partial<CompraParaDesempenho>): CompraParaDesempenho {
  return {
    fornecedorId: "f1",
    fornecedorNome: "Fornecedor 1",
    compradoEm: new Date("2026-08-01T12:00:00Z"),
    recebidoEm: new Date("2026-08-05T12:00:00Z"),
    prazoEntregaDiasPrometido: 5,
    divergenciaObservacao: null,
    ...parcial,
  };
}

describe("calcularDesempenhoFornecedores", () => {
  it("fornecedor com histórico bom: 100% no prazo, 100% completo, 100% OTIF", () => {
    const compras = [
      compra({ recebidoEm: new Date("2026-08-05T12:00:00Z") }), // exatamente no limite (5 dias)
      compra({ recebidoEm: new Date("2026-08-04T12:00:00Z") }), // antes do prazo
      compra({ recebidoEm: new Date("2026-08-03T12:00:00Z") }),
    ];

    const resultado = calcularDesempenhoFornecedores(compras).get("f1")!;

    expect(resultado.totalCompras).toBe(3);
    expect(resultado.noPrazo).toEqual({ amostra: 3, percentual: 100 });
    expect(resultado.completo).toEqual({ amostra: 3, percentual: 100 });
    expect(resultado.otif).toEqual({ amostra: 3, percentual: 100 });
    expect(resultado.comDivergencia).toBe(0);
  });

  it("fornecedor com divergências: entrega atrasada e incompleta derrubam OTIF mas não as métricas soltas erradamente", () => {
    const compras = [
      compra({ recebidoEm: new Date("2026-08-05T12:00:00Z"), divergenciaObservacao: null }), // no prazo, completo
      compra({ recebidoEm: new Date("2026-08-10T12:00:00Z"), divergenciaObservacao: null }), // atrasado, completo
      compra({ recebidoEm: new Date("2026-08-05T12:00:00Z"), divergenciaObservacao: "Faltou 1 caixa" }), // no prazo, incompleto
    ];

    const resultado = calcularDesempenhoFornecedores(compras).get("f1")!;

    expect(resultado.totalCompras).toBe(3);
    expect(resultado.noPrazo).toEqual({ amostra: 3, percentual: (2 / 3) * 100 });
    expect(resultado.completo).toEqual({ amostra: 3, percentual: (2 / 3) * 100 });
    // OTIF exige as duas coisas ao mesmo tempo — só a primeira compra bate.
    expect(resultado.otif).toEqual({ amostra: 3, percentual: (1 / 3) * 100 });
    expect(resultado.comDivergencia).toBe(1);
  });

  it("fornecedor com amostra pequena: dado insuficiente sinalizado pelo `amostra` abaixo do mínimo", () => {
    const compras = [compra({})];

    const resultado = calcularDesempenhoFornecedores(compras).get("f1")!;

    expect(resultado.totalCompras).toBe(1);
    expect(resultado.noPrazo.amostra).toBeLessThan(AMOSTRA_MINIMA_DESEMPENHO);
    expect(resultado.completo.amostra).toBeLessThan(AMOSTRA_MINIMA_DESEMPENHO);
    // O percentual ainda é calculado (100%) — quem exibe decide não confiar
    // nele com amostra < AMOSTRA_MINIMA_DESEMPENHO, a função só devolve o bruto.
    expect(resultado.noPrazo.percentual).toBe(100);
  });

  it("fornecedor sem nenhuma cotação vinculada: fica fora do denominador de 'no prazo'/OTIF, mas dentro do de 'completo'", () => {
    const compras = [
      compra({ prazoEntregaDiasPrometido: null }),
      compra({ prazoEntregaDiasPrometido: null, divergenciaObservacao: "Chegou errado" }),
      compra({ prazoEntregaDiasPrometido: 5 }), // esta tem cotação — única elegível pra no prazo/OTIF
    ];

    const resultado = calcularDesempenhoFornecedores(compras).get("f1")!;

    expect(resultado.totalCompras).toBe(3);
    // completo: 3 compras elegíveis (2 completas, 1 com divergência)
    expect(resultado.completo).toEqual({ amostra: 3, percentual: (2 / 3) * 100 });
    // no prazo/OTIF: só a compra com cotação entra no denominador
    expect(resultado.noPrazo).toEqual({ amostra: 1, percentual: 100 });
    expect(resultado.otif).toEqual({ amostra: 1, percentual: 100 });
    expect(resultado.comDivergencia).toBe(1);
  });

  it("fornecedor sem nenhuma cotação vinculada em NENHUMA compra: 'no prazo'/OTIF ficam sem dado (amostra 0, percentual null)", () => {
    const compras = [compra({ prazoEntregaDiasPrometido: null }), compra({ prazoEntregaDiasPrometido: null })];

    const resultado = calcularDesempenhoFornecedores(compras).get("f1")!;

    expect(resultado.noPrazo).toEqual({ amostra: 0, percentual: null });
    expect(resultado.otif).toEqual({ amostra: 0, percentual: null });
    // completo continua calculável — não depende de cotação.
    expect(resultado.completo).toEqual({ amostra: 2, percentual: 100 });
  });

  it("fornecedor sem nenhuma compra ainda: nem aparece no Map (nada pra agrupar)", () => {
    const resultado = calcularDesempenhoFornecedores([]);
    expect(resultado.size).toBe(0);
    expect(resultado.get("f1")).toBeUndefined();
  });

  it("agrupa corretamente vários fornecedores ao mesmo tempo, cada um com suas próprias métricas", () => {
    const compras = [
      compra({ fornecedorId: "f1", fornecedorNome: "Bom Fornecedor" }),
      compra({ fornecedorId: "f1", fornecedorNome: "Bom Fornecedor" }),
      compra({
        fornecedorId: "f2",
        fornecedorNome: "Fornecedor Lento",
        recebidoEm: new Date("2026-08-20T12:00:00Z"),
      }),
    ];

    const resultado = calcularDesempenhoFornecedores(compras);
    expect(resultado.size).toBe(2);
    expect(resultado.get("f1")!.totalCompras).toBe(2);
    expect(resultado.get("f1")!.noPrazo.percentual).toBe(100);
    expect(resultado.get("f2")!.totalCompras).toBe(1);
    expect(resultado.get("f2")!.noPrazo.percentual).toBe(0);
  });
});
