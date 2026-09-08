import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { producirEstoqueEspeculativo, ErroEstoqueInsuficientePreProducao } from "./pre-producao-estoque";

// Estoque de produto pré-produzido (pedido direto do dono, 2026-09-08 — ver
// deep-zooming-parasol.md). Teste de INTEGRAÇÃO de verdade (toca o Postgres
// de dev via DATABASE_URL), mesmo padrão de status-transicao.custo-automatico.test.ts.
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  materiaPrimaId: string;
  produtoId: string;
  precoCompra: number;
  quantidadePorUnidade: number;
};

async function criarFixture(opts?: { estoqueMateriaPrima?: number }): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Pré-Produção ${s}`, slug: `teste-pre-producao-${s}` },
  });

  const catalogoMateriaPrima = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché 150g ${s}` },
  });
  const precoCompra = 3.5;
  const materiaPrima = await prisma.itemGrafica.create({
    data: {
      graficaId: grafica.id,
      itemCatalogoId: catalogoMateriaPrima.id,
      precoCompra,
      estoqueAtual: opts?.estoqueMateriaPrima ?? 1000,
    },
  });

  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão de Visita ${s}` },
  });
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
  });

  const quantidadePorUnidade = 2;
  await prisma.fichaTecnicaItem.create({
    data: { itemGraficaId: produto.id, materiaPrimaId: materiaPrima.id, quantidadePorUnidade },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    materiaPrimaId: materiaPrima.id,
    produtoId: produto.id,
    precoCompra,
    quantidadePorUnidade,
  };
}

// Mesmo shape que a Server Action (lancarProducaoEspeculativa) busca e monta
// — ver ItemGraficaParaPreProducao em pre-producao-estoque.ts.
async function buscarItemGraficaParaPreProducao(produtoId: string) {
  const itemGrafica = await prisma.itemGrafica.findUniqueOrThrow({
    where: { id: produtoId },
    include: {
      itemCatalogo: true,
      fichaTecnica: {
        include: {
          materiaPrima: { include: { itemCatalogo: true } },
          variante: true,
        },
      },
    },
  });
  return {
    id: itemGrafica.id,
    modeloCalculo: itemGrafica.modeloCalculo,
    papelId: itemGrafica.papelId,
    nome: itemGrafica.itemCatalogo.nome,
    fichaTecnica: itemGrafica.fichaTecnica,
  };
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.fichaTecnicaItem.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("producirEstoqueEspeculativo (estoque de produto pré-produzido)", () => {
  it(
    "consome matéria-prima pela ficha técnica e incrementa o estoque do PRODUTO",
    async () => {
      const f = await criarFixture();
      const itemGrafica = await buscarItemGraficaParaPreProducao(f.produtoId);

      const resultado = await prisma.$transaction((tx) =>
        producirEstoqueEspeculativo(tx, { itemGrafica, quantidade: 100, criadoPorId: null })
      );

      // consumo = quantidadePorUnidade × quantidade = 2 × 100 = 200
      expect(Number(resultado.custoTotal)).toBeCloseTo(f.precoCompra * f.quantidadePorUnidade * 100, 2);
      expect(Number(resultado.custoUnitario)).toBeCloseTo(f.precoCompra * f.quantidadePorUnidade, 4);

      const materiaPrimaDepois = await prisma.itemGrafica.findUniqueOrThrow({
        where: { id: f.materiaPrimaId },
      });
      expect(Number(materiaPrimaDepois.estoqueAtual)).toBeCloseTo(1000 - 200, 4);

      const produtoDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.produtoId } });
      expect(Number(produtoDepois.estoqueAtual)).toBe(100);

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { itemGrafica: { graficaId: f.graficaId } },
        orderBy: { itemGraficaId: "asc" },
      });
      expect(movimentacoes).toHaveLength(2);
      const saida = movimentacoes.find((m) => m.tipo === "SAIDA_PRODUCAO")!;
      const entrada = movimentacoes.find((m) => m.tipo === "ENTRADA_PRODUCAO")!;
      expect(saida.itemGraficaId).toBe(f.materiaPrimaId);
      expect(saida.pedidoId).toBeNull();
      expect(Number(saida.quantidade)).toBeCloseTo(200, 4);
      expect(entrada.itemGraficaId).toBe(f.produtoId);
      expect(entrada.pedidoId).toBeNull();
      expect(Number(entrada.quantidade)).toBe(100);
    },
    TIMEOUT_MS
  );

  it(
    "segunda leva de pré-produção soma ao estoque já existente do PRODUTO (não sobrescreve)",
    async () => {
      const f = await criarFixture({ estoqueMateriaPrima: 10_000 });

      const item1 = await buscarItemGraficaParaPreProducao(f.produtoId);
      await prisma.$transaction((tx) =>
        producirEstoqueEspeculativo(tx, { itemGrafica: item1, quantidade: 50, criadoPorId: null })
      );

      const item2 = await buscarItemGraficaParaPreProducao(f.produtoId);
      await prisma.$transaction((tx) =>
        producirEstoqueEspeculativo(tx, { itemGrafica: item2, quantidade: 30, criadoPorId: null })
      );

      const produtoDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.produtoId } });
      expect(Number(produtoDepois.estoqueAtual)).toBe(80);
    },
    TIMEOUT_MS
  );

  it(
    "matéria-prima insuficiente aborta tudo — nada parcialmente gravado",
    async () => {
      // Estoque de matéria-prima só dá pra 40 unidades (2 × 40 = 80 ≤ 90),
      // pedir 100 (2 × 100 = 200) estoura.
      const f = await criarFixture({ estoqueMateriaPrima: 90 });
      const itemGrafica = await buscarItemGraficaParaPreProducao(f.produtoId);

      await expect(
        prisma.$transaction((tx) =>
          producirEstoqueEspeculativo(tx, { itemGrafica, quantidade: 100, criadoPorId: null })
        )
      ).rejects.toBeInstanceOf(ErroEstoqueInsuficientePreProducao);

      // Nada gravado: matéria-prima intocada, produto ainda sem estoque, sem
      // nenhuma MovimentacaoEstoque criada (transação abortada por inteiro).
      const materiaPrimaDepois = await prisma.itemGrafica.findUniqueOrThrow({
        where: { id: f.materiaPrimaId },
      });
      expect(Number(materiaPrimaDepois.estoqueAtual)).toBe(90);

      const produtoDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.produtoId } });
      expect(produtoDepois.estoqueAtual).toBeNull();

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { itemGrafica: { graficaId: f.graficaId } },
      });
      expect(movimentacoes).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "produto sem ficha técnica cadastrada: só soma ao estoque, custo fica null (nunca inventa R$0,00)",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Sem Ficha ${s}`, slug: `teste-sem-ficha-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto sem ficha ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
      });

      const itemGrafica = await buscarItemGraficaParaPreProducao(produto.id);
      expect(itemGrafica.fichaTecnica).toHaveLength(0);

      const resultado = await prisma.$transaction((tx) =>
        producirEstoqueEspeculativo(tx, { itemGrafica, quantidade: 20, criadoPorId: null })
      );
      expect(resultado.custoTotal).toBeNull();
      expect(resultado.custoUnitario).toBeNull();

      const produtoDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: produto.id } });
      expect(Number(produtoDepois.estoqueAtual)).toBe(20);
    },
    TIMEOUT_MS
  );
});
