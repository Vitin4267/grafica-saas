import { describe, it, expect } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import {
  calcularMargemItemOrcamento,
  calcularMargemAgregadaOrcamento,
  LIMIAR_MARGEM_RUIM,
  LIMIAR_MARGEM_ATENCAO,
} from "./orcamento-margem";

// Decimal do Prisma só importa como TIPO nestes testes — os valores reais
// passados são string/number puro (mesmo padrão de orcamento-precificacao.test.ts,
// que também não toca banco).
function item(dados: {
  precoTotal: string | number;
  quantidade: number;
  breakdown?: Prisma.JsonValue | null;
  precoCompra?: string | number | null;
  larguraCm?: string | number | null;
  alturaCm?: string | number | null;
  simplesCobraPorArea?: boolean;
}) {
  return {
    precoTotal: dados.precoTotal as unknown as Prisma.Decimal,
    quantidade: dados.quantidade,
    breakdown: dados.breakdown ?? null,
    precoCompra: (dados.precoCompra ?? null) as unknown as Prisma.Decimal | null,
    larguraCm: (dados.larguraCm ?? null) as unknown as Prisma.Decimal | null,
    alturaCm: (dados.alturaCm ?? null) as unknown as Prisma.Decimal | null,
    simplesCobraPorArea: dados.simplesCobraPorArea,
  };
}

describe("calcularMargemItemOrcamento", () => {
  it("usa breakdown.custoTotal quando presente (item M2/OFFSET)", () => {
    const resultado = calcularMargemItemOrcamento(
      item({ precoTotal: 100, quantidade: 1, breakdown: { custoTotal: "60" } })
    );
    expect(resultado).not.toBeNull();
    expect(resultado!.custoEstimado).toBe(60);
    expect(resultado!.margemPercent).toBeCloseTo(40);
  });

  it("usa precoCompra × quantidade quando não há breakdown (item SIMPLES)", () => {
    const resultado = calcularMargemItemOrcamento(
      item({ precoTotal: 50, quantidade: 5, precoCompra: 6 })
    );
    // custo = 6 * 5 = 30; margem = (50-30)/50 = 40%
    expect(resultado).not.toBeNull();
    expect(resultado!.custoEstimado).toBe(30);
    expect(resultado!.margemPercent).toBeCloseTo(40);
  });

  it("prioriza breakdown.custoTotal sobre precoCompra quando os dois existem", () => {
    const resultado = calcularMargemItemOrcamento(
      item({ precoTotal: 100, quantidade: 2, breakdown: { custoTotal: "20" }, precoCompra: 999 })
    );
    expect(resultado!.custoEstimado).toBe(20);
  });

  it("retorna margem negativa quando o custo é maior que o preço", () => {
    const resultado = calcularMargemItemOrcamento(
      item({ precoTotal: 40, quantidade: 1, breakdown: { custoTotal: "50" } })
    );
    expect(resultado!.margemPercent).toBeLessThan(0);
    expect(resultado!.margemPercent).toBeCloseTo(-25);
  });

  it("retorna null (custo desconhecido) sem breakdown e sem precoCompra — não inventa custo 0", () => {
    const resultado = calcularMargemItemOrcamento(item({ precoTotal: 100, quantidade: 1 }));
    expect(resultado).toBeNull();
  });

  it("retorna null quando breakdown existe mas sem custoTotal e sem precoCompra", () => {
    const resultado = calcularMargemItemOrcamento(
      item({ precoTotal: 100, quantidade: 1, breakdown: { detalhes: {} } })
    );
    expect(resultado).toBeNull();
  });

  it("retorna null pra precoTotal zero ou inválido", () => {
    expect(calcularMargemItemOrcamento(item({ precoTotal: 0, quantidade: 1, precoCompra: 5 }))).toBeNull();
    expect(
      calcularMargemItemOrcamento(item({ precoTotal: "não-numero", quantidade: 1, precoCompra: 5 }))
    ).toBeNull();
  });

  // Achado N11(b) — item SIMPLES cobrado por m² (ItemGrafica.simplesCobraPorArea):
  // o preço já escalou pela área, então o custo precisa escalar junto, senão
  // a margem calculada fica artificialmente alta.
  it("multiplica precoCompra por área quando simplesCobraPorArea=true e largura/altura vêm preenchidas", () => {
    // Banner 3m×2m = 6m², precoCompra 18/m², quantidade 1 -> custo = 108.
    // precoTotal (venda) = 60/m² × 6m² = 360 -> margem = (360-108)/360 = 70%.
    const resultado = calcularMargemItemOrcamento(
      item({
        precoTotal: 360,
        quantidade: 1,
        precoCompra: 18,
        larguraCm: 300,
        alturaCm: 200,
        simplesCobraPorArea: true,
      })
    );
    expect(resultado).not.toBeNull();
    expect(resultado!.custoEstimado).toBe(108);
    expect(resultado!.margemPercent).toBeCloseTo(70);
  });

  it("ignora largura/altura quando simplesCobraPorArea não está ligado (comportamento de sempre)", () => {
    const resultado = calcularMargemItemOrcamento(
      item({
        precoTotal: 450,
        quantidade: 10,
        precoCompra: 20,
        larguraCm: 300,
        alturaCm: 200,
        simplesCobraPorArea: false,
      })
    );
    expect(resultado).not.toBeNull();
    expect(resultado!.custoEstimado).toBe(200); // 20 × 10, sem área
  });

  it("simplesCobraPorArea=true mas sem dimensão preenchida — cai pra custo × quantidade (área=1)", () => {
    const resultado = calcularMargemItemOrcamento(
      item({ precoTotal: 450, quantidade: 10, precoCompra: 20, simplesCobraPorArea: true })
    );
    expect(resultado!.custoEstimado).toBe(200);
  });
});

describe("calcularMargemAgregadaOrcamento", () => {
  it("soma custo e preço de todos os itens com custo conhecido", () => {
    const resultado = calcularMargemAgregadaOrcamento([
      item({ precoTotal: 100, quantidade: 1, breakdown: { custoTotal: "50" } }),
      item({ precoTotal: 200, quantidade: 2, precoCompra: 25 }), // custo = 50
    ]);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      // preco total = 300, custo total = 100 -> margem = (300-100)/300 = 66.67%
      expect(resultado.precoTotal).toBe(300);
      expect(resultado.custoEstimadoTotal).toBe(100);
      expect(resultado.margemPercent).toBeCloseTo((200 / 300) * 100);
    }
  });

  it("fica ok:false se qualquer item vendável não tiver custo conhecido (não finge total parcial)", () => {
    const resultado = calcularMargemAgregadaOrcamento([
      item({ precoTotal: 100, quantidade: 1, breakdown: { custoTotal: "50" } }),
      item({ precoTotal: 50, quantidade: 1 }), // sem breakdown nem precoCompra
    ]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.itensSemCusto).toBe(1);
    }
  });

  it("ignora itens sem preço (precoTotal <= 0) na contagem de itensSemCusto", () => {
    const resultado = calcularMargemAgregadaOrcamento([
      item({ precoTotal: 0, quantidade: 1 }),
      item({ precoTotal: 100, quantidade: 1, breakdown: { custoTotal: "10" } }),
    ]);
    expect(resultado.ok).toBe(true);
  });

  it("fica ok:false pra lista vazia", () => {
    const resultado = calcularMargemAgregadaOrcamento([]);
    expect(resultado.ok).toBe(false);
  });
});

describe("limiares fixos da tela", () => {
  it("LIMIAR_MARGEM_RUIM é maior que zero (pra margem exatamente 0 contar como ruim)", () => {
    expect(LIMIAR_MARGEM_RUIM).toBeGreaterThan(0);
  });

  it("LIMIAR_MARGEM_ATENCAO é 15%, conforme decisão de escopo da feature", () => {
    expect(LIMIAR_MARGEM_ATENCAO).toBe(15);
  });
});
