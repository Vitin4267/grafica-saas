import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import { montarChavePerda } from "@/lib/perda-fixa-producao";

// avancarStatusPedido chama revalidatePath no final — fora de uma requisição
// Next.js de verdade (mesmo mock de status-transicao.custo-automatico.test.ts).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de status-transicao.custo-automatico.test.ts) — cobre o
// achado N5 da auditoria de código (2026-09-04): a baixa de matéria-prima
// passa a usar o consumo FÍSICO real que o motor avançado (OFFSET/M2/
// FLEXOGRAFIA) já calculou em OrcamentoItem.breakdown, em vez do consumo
// linear (quantidadePorUnidade × quantidade), SÓ na linha de ficha técnica
// identificada como o substrato — ver src/lib/baixa-estoque-substrato.ts.
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

// Mesma ordem de exclusão (respeitando FKs Restrict/self-referenciais do
// schema) de status-transicao.custo-automatico.test.ts.
afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.fichaTecnicaItem.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarBase() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Substrato Motor ${s}`, slug: `teste-substrato-motor-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-substrato-motor-${s}@example.com`, senhaHash: "x" },
  });
  await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 500 },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { s, grafica, cliente, usuario, orcamento };
}

function pedidoParaAvanco(params: { graficaId: string; orcamentoId: string; pedidoId: string }): PedidoParaAvanco {
  return {
    id: params.pedidoId,
    graficaId: params.graficaId,
    orcamentoId: params.orcamentoId,
    status: "CLICHE_FACA",
    arteUrl: null,
    arteAprovadaEm: null,
    producaoLinkToken: null,
    orcamento: {
      clienteId: "cliente-teste",
      condicaoPagamentoId: null,
      total: 0,
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [{ quantidade: 1, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
    },
  };
}

describe("achado N5 — baixa de estoque usa o consumo físico do motor avançado quando aplicável", () => {
  it(
    "OFFSET: papel (via ItemGrafica.papelId, identificação automática) usa folhasTotais do breakdown; tinta (não-substrato) continua linear",
    async () => {
      const { s, grafica, orcamento } = await criarBase();

      const catalogoPapel = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché 300g ${s}`, unidade: "FOLHA" },
      });
      const papel = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoPapel.id, precoCompra: 1.2, estoqueAtual: 10_000 },
      });

      const catalogoTinta = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Tinta", nome: `Tinta preta ${s}`, unidade: "LITRO" },
      });
      const tinta = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoTinta.id, precoCompra: 40, estoqueAtual: 1000 },
      });

      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Offset ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id, modeloCalculo: "OFFSET", papelId: papel.id },
      });

      // quantidadePorUnidade deliberadamente MUITO diferente de folhasTotais
      // (5 vs 137) — se o fallback linear disparasse por engano, o teste
      // veria 500×0,01=5, nunca 137, tornando a distinção inequívoca.
      const fichaPapel = await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: produto.id, materiaPrimaId: papel.id, quantidadePorUnidade: 0.01 },
      });
      const fichaTinta = await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: produto.id, materiaPrimaId: tinta.id, quantidadePorUnidade: 0.05 },
      });

      const quantidadeItem = 500;
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: quantidadeItem,
          precoUnitario: 1,
          precoTotal: quantidadeItem,
          modeloCalculo: "OFFSET",
          breakdown: { metricas: { folhasTotais: 137, pesoTotalPedidoKg: 12.3 } },
        },
      });

      const pedido = await prisma.pedido.create({
        data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
      });

      const perdas = JSON.stringify([
        { chave: montarChavePerda(orcamentoItem.id, fichaPapel.id), perdaAplicada: 0 },
        { chave: montarChavePerda(orcamentoItem.id, fichaTinta.id), perdaAplicada: 0 },
      ]);

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco({ graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id }),
        perdas
      );
      expect(resultado.ok).toBe(true);

      const movimentacaoPapel = await prisma.movimentacaoEstoque.findFirst({
        where: { pedidoId: pedido.id, itemGraficaId: papel.id },
      });
      expect(movimentacaoPapel).not.toBeNull();
      // Consumo FÍSICO do motor (folhasTotais), não linear (500×0,01=5).
      expect(Number(movimentacaoPapel!.quantidade)).toBe(137);

      const papelAposBaixa = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: papel.id } });
      expect(Number(papelAposBaixa.estoqueAtual)).toBe(10_000 - 137);

      const movimentacaoTinta = await prisma.movimentacaoEstoque.findFirst({
        where: { pedidoId: pedido.id, itemGraficaId: tinta.id },
      });
      expect(movimentacaoTinta).not.toBeNull();
      // Tinta não é o substrato (materiaPrimaId != papelId, ehSubstratoPrincipal
      // default false) — continua 100% linear mesmo o item sendo OFFSET com
      // breakdown presente.
      expect(Number(movimentacaoTinta!.quantidade)).toBe(0.05 * quantidadeItem);
    },
    TIMEOUT_MS
  );

  it(
    "M2 com clichê de etiqueta: papel (via OrcamentoItemPrecificacaoEtiqueta.papelId, identificação automática) usa areaFaturavel do breakdown",
    async () => {
      const { s, grafica, orcamento } = await criarBase();

      const catalogoPapel = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Etiqueta", nome: `BOPP Branco ${s}`, unidade: "METRO_QUADRADO" },
      });
      const papel = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoPapel.id, precoCompra: 5, estoqueAtual: 1000 },
      });

      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Etiqueta", nome: `Rótulo M2 ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id, modeloCalculo: "M2" },
      });

      const fichaPapel = await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: produto.id, materiaPrimaId: papel.id, quantidadePorUnidade: 0.001 },
      });

      const quantidadeItem = 1000;
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: quantidadeItem,
          precoUnitario: 1,
          precoTotal: quantidadeItem,
          modeloCalculo: "M2",
          breakdown: { metricas: { areaFaturavel: 8.4 } },
        },
      });
      await prisma.orcamentoItemPrecificacaoEtiqueta.create({
        data: {
          orcamentoItemId: orcamentoItem.id,
          papelId: papel.id,
          quantidadeCores: 4,
          custoClicheCalculado: 10,
        },
      });

      const pedido = await prisma.pedido.create({
        data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
      });

      const perdas = JSON.stringify([{ chave: montarChavePerda(orcamentoItem.id, fichaPapel.id), perdaAplicada: 0 }]);

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco({ graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id }),
        perdas
      );
      expect(resultado.ok).toBe(true);

      const movimentacao = await prisma.movimentacaoEstoque.findFirst({
        where: { pedidoId: pedido.id, itemGraficaId: papel.id },
      });
      expect(movimentacao).not.toBeNull();
      // Consumo FÍSICO do motor (areaFaturavel), não linear (1000×0,001=1).
      expect(Number(movimentacao!.quantidade)).toBe(8.4);
    },
    TIMEOUT_MS
  );

  it(
    "FLEXOGRAFIA: sem FK de papel disponível no motor — só usa metragemLinearM quando a linha está marcada ehSubstratoPrincipal=true",
    async () => {
      const { s, grafica, orcamento } = await criarBase();

      const catalogoBobina = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Bobina", nome: `BOPP Rolo ${s}`, unidade: "METRO_LINEAR" },
      });
      const bobina = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoBobina.id, precoCompra: 2, estoqueAtual: 1000 },
      });

      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Embalagem Flexível", nome: `Sacola Flexo ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id, modeloCalculo: "FLEXOGRAFIA" },
      });

      // ehSubstratoPrincipal=true — único jeito de identificar o substrato em
      // FLEXOGRAFIA, já que o motor não referencia nenhuma FK de matéria-prima
      // (ver comentário do campo no schema e em baixa-estoque-substrato.ts).
      const fichaBobina = await prisma.fichaTecnicaItem.create({
        data: {
          itemGraficaId: produto.id,
          materiaPrimaId: bobina.id,
          quantidadePorUnidade: 0.02,
          ehSubstratoPrincipal: true,
        },
      });

      const quantidadeItem = 2000;
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: quantidadeItem,
          precoUnitario: 1,
          precoTotal: quantidadeItem,
          modeloCalculo: "FLEXOGRAFIA",
          breakdown: { metricas: { metragemLinearM: 63.7 } },
        },
      });

      const pedido = await prisma.pedido.create({
        data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
      });

      const perdas = JSON.stringify([{ chave: montarChavePerda(orcamentoItem.id, fichaBobina.id), perdaAplicada: 0 }]);

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco({ graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id }),
        perdas
      );
      expect(resultado.ok).toBe(true);

      const movimentacao = await prisma.movimentacaoEstoque.findFirst({
        where: { pedidoId: pedido.id, itemGraficaId: bobina.id },
      });
      expect(movimentacao).not.toBeNull();
      // Consumo FÍSICO do motor (metragemLinearM), não linear (2000×0,02=40).
      expect(Number(movimentacao!.quantidade)).toBe(63.7);
    },
    TIMEOUT_MS
  );

  it(
    "FLEXOGRAFIA sem ehSubstratoPrincipal marcado: mesmo com breakdown presente, consumo continua linear (default conservador, zero regressão)",
    async () => {
      const { s, grafica, orcamento } = await criarBase();

      const catalogoBobina = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Bobina", nome: `BOPP Rolo ${s}`, unidade: "METRO_LINEAR" },
      });
      const bobina = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoBobina.id, precoCompra: 2, estoqueAtual: 1000 },
      });

      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Embalagem Flexível", nome: `Sacola Flexo Sem Flag ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id, modeloCalculo: "FLEXOGRAFIA" },
      });

      // ehSubstratoPrincipal NÃO marcado (default false) — nenhuma flag, nenhuma FK.
      const fichaBobina = await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: produto.id, materiaPrimaId: bobina.id, quantidadePorUnidade: 0.02 },
      });

      const quantidadeItem = 2000;
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: quantidadeItem,
          precoUnitario: 1,
          precoTotal: quantidadeItem,
          modeloCalculo: "FLEXOGRAFIA",
          breakdown: { metricas: { metragemLinearM: 63.7 } },
        },
      });

      const pedido = await prisma.pedido.create({
        data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
      });

      const perdas = JSON.stringify([{ chave: montarChavePerda(orcamentoItem.id, fichaBobina.id), perdaAplicada: 0 }]);

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco({ graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id }),
        perdas
      );
      expect(resultado.ok).toBe(true);

      const movimentacao = await prisma.movimentacaoEstoque.findFirst({
        where: { pedidoId: pedido.id, itemGraficaId: bobina.id },
      });
      expect(movimentacao).not.toBeNull();
      // Sem identificação de substrato possível — cai no linear de sempre
      // (2000×0,02=40), NUNCA no metragemLinearM do breakdown (63,7).
      expect(Number(movimentacao!.quantidade)).toBe(0.02 * quantidadeItem);
    },
    TIMEOUT_MS
  );

  it(
    "item SIMPLES (sem breakdown de motor avançado) continua 100% linear — regressão zero",
    async () => {
      const { s, grafica, orcamento } = await criarBase();

      const catalogoPapel = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché Simples ${s}`, unidade: "FOLHA" },
      });
      const papel = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoPapel.id, precoCompra: 1, estoqueAtual: 1000 },
      });

      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Simples ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id }, // modeloCalculo default SIMPLES
      });

      const fichaPapel = await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: produto.id, materiaPrimaId: papel.id, quantidadePorUnidade: 2 },
      });

      const quantidadeItem = 10;
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: quantidadeItem,
          precoUnitario: 50,
          precoTotal: 500,
          // modeloCalculo default SIMPLES, breakdown null — nada muda aqui.
        },
      });

      const pedido = await prisma.pedido.create({
        data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
      });

      const perdas = JSON.stringify([{ chave: montarChavePerda(orcamentoItem.id, fichaPapel.id), perdaAplicada: 0 }]);

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco({ graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id }),
        perdas
      );
      expect(resultado.ok).toBe(true);

      const movimentacao = await prisma.movimentacaoEstoque.findFirst({
        where: { pedidoId: pedido.id, itemGraficaId: papel.id },
      });
      expect(movimentacao).not.toBeNull();
      expect(Number(movimentacao!.quantidade)).toBe(2 * quantidadeItem);
    },
    TIMEOUT_MS
  );
});
