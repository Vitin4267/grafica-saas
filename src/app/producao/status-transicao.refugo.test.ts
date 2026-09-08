import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import type { RefugoInput } from "@/lib/refugo-producao";

// Achado B3 da Parte 2 (Produção) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-09-07): refugo real de produção
// (folhas cortadas errado, peça com defeito, falha de tinta no meio de uma
// bobina) não tinha onde ser registrado depois da perda de calibragem (que
// só acontece uma vez, na entrada em PRODUCAO). Mesmo padrão de teste de
// integração REAL (toca o Postgres de dev via DATABASE_URL) de
// status-transicao.custo-automatico.test.ts.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  categoriaCustoId: string;
  materiaPrimaId: string;
  produtoId: string;
  orcamentoId: string;
  orcamentoItemId: string;
  pedidoId: string;
  precoCompra: number;
  quantidadePorUnidade: number;
  quantidadeItem: number;
};

// Fixture com pedido já em PRODUCAO (a etapa que o refugo descreve) —
// diferente de status-transicao.custo-automatico.test.ts (que testa a
// ENTRADA em PRODUCAO), este arquivo testa a SAÍDA dela (PRODUCAO→
// ACABAMENTO), que é onde o refugo de fato é reportado na prática.
async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Refugo ${s}`, slug: `teste-refugo-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-refugo-${s}@example.com`, senhaHash: "x" },
  });
  const categoria = await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });

  const catalogoMateriaPrima = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché 150g ${s}` },
  });
  const precoCompra = 3.5;
  const materiaPrima = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoMateriaPrima.id, precoCompra, estoqueAtual: 1000 },
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

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 500 },
  });
  const quantidadeItem = 10;
  const orcamentoItem = await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: produto.id,
      quantidade: quantidadeItem,
      precoUnitario: 50,
      precoTotal: 500,
    },
  });

  // Pedido já em PRODUCAO — é a etapa que o refugo (B3) descreve; avançar
  // pra ACABAMENTO fecha o apontamento de PRODUCAO com o refugo reportado.
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "PRODUCAO" },
  });
  await prisma.apontamentoEtapa.create({
    data: { graficaId: grafica.id, pedidoId: pedido.id, status: "PRODUCAO", origemConfirmacao: "APP" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    categoriaCustoId: categoria.id,
    materiaPrimaId: materiaPrima.id,
    produtoId: produto.id,
    orcamentoId: orcamento.id,
    orcamentoItemId: orcamentoItem.id,
    pedidoId: pedido.id,
    precoCompra,
    quantidadePorUnidade,
    quantidadeItem,
  };
}

function pedidoParaAvanco(f: Fixture): PedidoParaAvanco {
  return {
    id: f.pedidoId,
    graficaId: f.graficaId,
    orcamentoId: f.orcamentoId,
    status: "PRODUCAO",
    arteUrl: null,
    arteAprovadaEm: null,
    producaoLinkToken: null,
    orcamento: {
      clienteId: "cliente-teste",
      condicaoPagamentoId: null,
      total: 0,
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [{ quantidade: f.quantidadeItem, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
    },
  };
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.apontamentoEtapa.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.fichaTecnicaItem.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("refugo de produção — achado B3", () => {
  it(
    "sem refugo (undefined): comportamento de hoje, campos ficam null no apontamento fechado",
    async () => {
      const f = await criarFixture();
      const resultado = await avancarStatusPedido(pedidoParaAvanco(f), null, {
        origemConfirmacao: "APP",
        operadorId: null,
      });
      expect(resultado.ok).toBe(true);

      const fechado = await prisma.apontamentoEtapa.findFirst({
        where: { pedidoId: f.pedidoId, status: "PRODUCAO" },
      });
      expect(fechado?.finalizadoEm).not.toBeNull();
      expect(fechado?.quantidadeBoa).toBeNull();
      expect(fechado?.quantidadeRefugo).toBeNull();
      expect(fechado?.motivoRefugo).toBeNull();

      // Nenhuma movimentação/custo extra além do que já existiria sem esta
      // feature (nesta fixture, nada — a baixa automática já foi feita ao
      // ENTRAR em PRODUCAO, fora do escopo deste teste).
      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "reporta quantidadeBoa/quantidadeRefugo/motivo no apontamento fechado, sem baixa de estoque quando gerarBaixaEstoque=false",
    async () => {
      const f = await criarFixture();
      const refugo: RefugoInput = {
        quantidadeBoa: 990,
        quantidadeRefugo: 10,
        motivoRefugo: "FALHA_IMPRESSAO",
        motivoRefugoOutro: null,
        gerarBaixaEstoque: false,
      };
      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f),
        null,
        { origemConfirmacao: "APP", operadorId: null },
        refugo
      );
      expect(resultado.ok).toBe(true);

      const fechado = await prisma.apontamentoEtapa.findFirst({
        where: { pedidoId: f.pedidoId, status: "PRODUCAO" },
      });
      expect(fechado?.quantidadeBoa).toBe(990);
      expect(fechado?.quantidadeRefugo).toBe(10);
      expect(fechado?.motivoRefugo).toBe("FALHA_IMPRESSAO");

      // gerarBaixaEstoque=false — o refugo é só registrado, nunca imposta a
      // baixa (ver enunciado do achado B3).
      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "gerarBaixaEstoque=true gera MovimentacaoEstoque + CustoPedido proporcionais ao refugo",
    async () => {
      const f = await criarFixture();
      const refugo: RefugoInput = {
        quantidadeBoa: 990,
        quantidadeRefugo: 10,
        motivoRefugo: "FALHA_IMPRESSAO",
        motivoRefugoOutro: null,
        gerarBaixaEstoque: true,
      };
      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f),
        null,
        { origemConfirmacao: "APP", operadorId: null },
        refugo
      );
      expect(resultado.ok).toBe(true);

      // consumoPorUnidade = (quantidadePorUnidade × quantidadeItem) / quantidadeItem
      //                   = quantidadePorUnidade = 2; baixa = 2 × 10 = 20.
      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(1);
      expect(Number(movimentacoes[0].quantidade)).toBeCloseTo(f.quantidadePorUnidade * 10, 4);
      expect(movimentacoes[0].motivo).toContain("Refugo de produção");
      expect(Number(movimentacoes[0].custoTotal)).toBeCloseTo(f.precoCompra * f.quantidadePorUnidade * 10, 2);

      const materiaPrimaAposBaixa = await prisma.itemGrafica.findUniqueOrThrow({
        where: { id: f.materiaPrimaId },
      });
      expect(Number(materiaPrimaAposBaixa.estoqueAtual)).toBeCloseTo(1000 - f.quantidadePorUnidade * 10, 4);

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(1);
      expect(custos[0].origem).toBe("CONSUMO_ESTOQUE");
      expect(Number(custos[0].valor)).toBeCloseTo(f.precoCompra * f.quantidadePorUnidade * 10, 2);
    },
    TIMEOUT_MS
  );

  it(
    "MATERIAL_DEFEITUOSO: baixa de estoque acontece, mas NENHUM CustoPedido automático é gerado",
    async () => {
      const f = await criarFixture();
      const refugo: RefugoInput = {
        quantidadeBoa: 990,
        quantidadeRefugo: 10,
        motivoRefugo: "MATERIAL_DEFEITUOSO",
        motivoRefugoOutro: null,
        gerarBaixaEstoque: true,
      };
      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f),
        null,
        { origemConfirmacao: "APP", operadorId: null },
        refugo
      );
      expect(resultado.ok).toBe(true);

      // A MovimentacaoEstoque acontece igual — o material saiu fisicamente.
      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(1);
      expect(Number(movimentacoes[0].quantidade)).toBeCloseTo(f.quantidadePorUnidade * 10, 4);

      // Mas nenhum CustoPedido automático — custo potencialmente
      // recuperável do fornecedor, ver comentário no enum MotivoRefugo.
      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "estoque insuficiente pra baixa de refugo bloqueia a transição inteira (nem o status avança)",
    async () => {
      const f = await criarFixture();
      // Refugo gigante — a baixa proporcional (quantidadePorUnidade × refugo)
      // estoura o estoque de 1000.
      const refugo: RefugoInput = {
        quantidadeBoa: 0,
        quantidadeRefugo: 10_000,
        motivoRefugo: "FALHA_IMPRESSAO",
        motivoRefugoOutro: null,
        gerarBaixaEstoque: true,
      };
      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f),
        null,
        { origemConfirmacao: "APP", operadorId: null },
        refugo
      );
      expect(resultado.ok).toBe(false);

      // A transição inteira foi revertida — pedido continua em PRODUCAO,
      // apontamento de PRODUCAO continua aberto.
      const pedidoAposFalha = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoAposFalha.status).toBe("PRODUCAO");
      const aberto = await prisma.apontamentoEtapa.findFirst({
        where: { pedidoId: f.pedidoId, finalizadoEm: null },
      });
      expect(aberto?.status).toBe("PRODUCAO");

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "quantidadeRefugo=0 (sem refugo real) não gera baixa mesmo com gerarBaixaEstoque=true marcado",
    async () => {
      const f = await criarFixture();
      const refugo: RefugoInput = {
        quantidadeBoa: 1000,
        quantidadeRefugo: 0,
        motivoRefugo: null,
        motivoRefugoOutro: null,
        gerarBaixaEstoque: true,
      };
      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f),
        null,
        { origemConfirmacao: "APP", operadorId: null },
        refugo
      );
      expect(resultado.ok).toBe(true);

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(0);

      const fechado = await prisma.apontamentoEtapa.findFirst({
        where: { pedidoId: f.pedidoId, status: "PRODUCAO" },
      });
      expect(fechado?.quantidadeBoa).toBe(1000);
      expect(fechado?.quantidadeRefugo).toBe(0);
    },
    TIMEOUT_MS
  );
});
