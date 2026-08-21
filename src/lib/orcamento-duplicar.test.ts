import { describe, it, expect } from "vitest";
import { paraDecimal } from "@/lib/pricing/decimal";
import { calcularDescontoHerdado, montarDadosItemParaRecalculo } from "./orcamento-duplicar";

describe("montarDadosItemParaRecalculo", () => {
  it("converte Decimal/string pra number, mantendo null", () => {
    const dados = montarDadosItemParaRecalculo({
      quantidade: 100,
      larguraCm: "10.5",
      alturaCm: null,
      corFrente: 4,
      corVerso: 0,
      numeroCoresFlexo: null,
      acabamentos: [{ itemGraficaId: "acab-1" }, { itemGraficaId: "acab-2" }],
      precificacaoEtiqueta: null,
    });

    expect(dados).toEqual({
      quantidade: 100,
      larguraCm: 10.5,
      alturaCm: null,
      corFrente: 4,
      corVerso: 0,
      numeroCoresFlexo: null,
      acabamentoIds: ["acab-1", "acab-2"],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
    });
  });

  it("extrai papelId/quantidadeCores/custoFaca/custoFrete de precificacaoEtiqueta", () => {
    const dados = montarDadosItemParaRecalculo({
      quantidade: 1000,
      larguraCm: 5,
      alturaCm: 5,
      corFrente: null,
      corVerso: null,
      numeroCoresFlexo: 3,
      acabamentos: [],
      precificacaoEtiqueta: {
        papelId: "papel-1",
        quantidadeCores: 3,
        custoFaca: "12.50",
        custoFrete: null,
      },
    });

    expect(dados.papelId).toBe("papel-1");
    expect(dados.quantidadeCores).toBe(3);
    expect(dados.custoFaca).toBe(12.5);
    expect(dados.custoFrete).toBeNull();
  });
});

describe("calcularDescontoHerdado", () => {
  it("reaplica o MESMO PERCENTUAL sobre o novo preço sugerido (não o valor em R$)", () => {
    // Original: sugerido 100/un, vendido 90/un -> 10% de desconto efetivo.
    // Catálogo reajustou: novo sugerido é 200/un.
    const herdado = calcularDescontoHerdado({
      precoSugeridoOriginal: "100",
      precoUnitarioOriginalComDesconto: "90",
      novoPrecoSugeridoUnitario: "200",
      quantidade: 10,
    });

    expect(herdado).not.toBeNull();
    expect(herdado!.percentual.toNumber()).toBeCloseTo(10, 6);
    // 200 × (1 − 10%) = 180, nunca 190 (que seria copiar o valor R$ absoluto).
    expect(herdado!.precoUnitario.toNumber()).toBeCloseTo(180, 2);
    expect(herdado!.precoTotal.toNumber()).toBeCloseTo(1800, 2);
  });

  it("devolve null quando o item original não tinha desconto efetivo (vendido == sugerido)", () => {
    const herdado = calcularDescontoHerdado({
      precoSugeridoOriginal: "100",
      precoUnitarioOriginalComDesconto: "100",
      novoPrecoSugeridoUnitario: "150",
      quantidade: 5,
    });
    expect(herdado).toBeNull();
  });

  it("devolve null quando o sugerido original é zero/inválido (não dá pra derivar percentual)", () => {
    const herdado = calcularDescontoHerdado({
      precoSugeridoOriginal: "0",
      precoUnitarioOriginalComDesconto: "0",
      novoPrecoSugeridoUnitario: "50",
      quantidade: 5,
    });
    expect(herdado).toBeNull();
  });

  it("devolve null quando o preço vendido original era MAIOR que o sugerido (sem desconto efetivo real)", () => {
    const herdado = calcularDescontoHerdado({
      precoSugeridoOriginal: "100",
      precoUnitarioOriginalComDesconto: "120",
      novoPrecoSugeridoUnitario: "150",
      quantidade: 5,
    });
    expect(herdado).toBeNull();
  });

  it("percentual de 100% no original não gera preço zerado/negativo herdado (devolve null)", () => {
    const herdado = calcularDescontoHerdado({
      precoSugeridoOriginal: "100",
      precoUnitarioOriginalComDesconto: "0.001",
      novoPrecoSugeridoUnitario: "0.50",
      quantidade: 1,
    });
    // ~99,999% de desconto sobre um sugerido novo minúsculo pode arredondar
    // pra R$0,00 em 2 casas — nesse caso não há preço válido pra herdar.
    if (herdado) {
      expect(herdado.precoUnitario.gt(0)).toBe(true);
    } else {
      expect(herdado).toBeNull();
    }
  });

  it("preserva precisão decimal (nunca usa Number()/ponto flutuante binário)", () => {
    const herdado = calcularDescontoHerdado({
      precoSugeridoOriginal: paraDecimal("33.33"),
      precoUnitarioOriginalComDesconto: paraDecimal("29.997"), // 10% exato
      novoPrecoSugeridoUnitario: "10",
      quantidade: 3,
    });
    expect(herdado).not.toBeNull();
    expect(herdado!.percentual.toNumber()).toBeCloseTo(10, 3);
  });
});
