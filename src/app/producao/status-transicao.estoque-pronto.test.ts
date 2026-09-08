import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import { montarChavePerda } from "@/lib/perda-fixa-producao";

// Estoque de produto pré-produzido (pedido direto do dono, 2026-09-08 — ver
// deep-zooming-parasol.md) — "atender pedido do estoque pronto": hook em
// avancarStatusPedido (branch condicional dentro do loop existente, mesmo
// precedente do achado B3/refugo) que, quando o item vem marcado, PULA o
// consumo de matéria-prima e desconta direto do estoque pré-produzido do
// PRODUTO. Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via
// DATABASE_URL), mesmo padrão de status-transicao.custo-automatico.test.ts.
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
  materiaPrimaId: string;
  produtoId: string;
  orcamentoId: string;
  orcamentoItemId: string;
  fichaTecnicaItemId: string;
  pedidoId: string;
  precoCompra: number;
  quantidadePorUnidade: number;
  quantidadeItem: number;
  custoUnitarioPreProduzido: number | null;
};

async function criarFixture(opts: {
  estoqueProduto: number;
  quantidadeItem?: number;
  custoUnitarioPreProduzido?: number | null;
}): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Estoque Pronto ${s}`, slug: `teste-estoque-pronto-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-estoque-pronto-${s}@example.com`, senhaHash: "x" },
  });
  await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });

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
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id, estoqueAtual: opts.estoqueProduto },
  });

  const quantidadePorUnidade = 2;
  const fichaTecnicaItem = await prisma.fichaTecnicaItem.create({
    data: { itemGraficaId: produto.id, materiaPrimaId: materiaPrima.id, quantidadePorUnidade },
  });

  // Simula uma pré-produção anterior (ENTRADA_PRODUCAO) — é dela que
  // aplicarAtendimentoEstoquePronto lê o custoUnitario snapshotado (critério
  // "última entrada não esgotada", v1). `custoUnitarioPreProduzido: null`
  // simula um produto com estoque (ex: ajuste manual) mas SEM nenhuma
  // ENTRADA_PRODUCAO — custo do atendimento fica null nesse caso. Usa
  // Comparação explícita com `undefined` em vez de `??` — `??` trataria
  // "não passou a opção" (default 8.5) e "passou null explicitamente"
  // (simula produto sem nenhuma ENTRADA_PRODUCAO) como a mesma coisa,
  // porque null também é nullish.
  const custoUnitarioPreProduzido: number | null =
    opts.custoUnitarioPreProduzido === undefined ? 8.5 : opts.custoUnitarioPreProduzido;
  if (custoUnitarioPreProduzido !== null) {
    await prisma.movimentacaoEstoque.create({
      data: {
        itemGraficaId: produto.id,
        tipo: "ENTRADA_PRODUCAO",
        quantidade: opts.estoqueProduto,
        custoUnitario: custoUnitarioPreProduzido,
        custoTotal: custoUnitarioPreProduzido * opts.estoqueProduto,
      },
    });
  }

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 500 },
  });
  const quantidadeItem = opts.quantidadeItem ?? 10;
  const orcamentoItem = await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: produto.id,
      quantidade: quantidadeItem,
      precoUnitario: 50,
      precoTotal: 500,
    },
  });

  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    materiaPrimaId: materiaPrima.id,
    produtoId: produto.id,
    orcamentoId: orcamento.id,
    orcamentoItemId: orcamentoItem.id,
    fichaTecnicaItemId: fichaTecnicaItem.id,
    pedidoId: pedido.id,
    precoCompra,
    quantidadePorUnidade,
    quantidadeItem,
    custoUnitarioPreProduzido,
  };
}

function pedidoParaAvanco(f: Fixture): PedidoParaAvanco {
  return {
    id: f.pedidoId,
    graficaId: f.graficaId,
    orcamentoId: f.orcamentoId,
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
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("atender pedido do estoque pré-produzido", () => {
  it(
    "item marcado + estoque suficiente: não gera SAIDA_PRODUCAO de matéria-prima, gera SAIDA_ATENDIMENTO_PEDIDO + CustoPedido origem PRODUTO_PRE_PRODUZIDO",
    async () => {
      const f = await criarFixture({ estoqueProduto: 100, quantidadeItem: 10 });

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f),
        JSON.stringify([]),
        { origemConfirmacao: "APP", operadorId: null },
        null,
        [f.orcamentoItemId]
      );
      expect(resultado.ok).toBe(true);

      // Matéria-prima intocada — nenhuma SAIDA_PRODUCAO gerada pra este item.
      const materiaPrimaDepois = await prisma.itemGrafica.findUniqueOrThrow({
        where: { id: f.materiaPrimaId },
      });
      expect(Number(materiaPrimaDepois.estoqueAtual)).toBe(1000);
      const saidasProducao = await prisma.movimentacaoEstoque.findMany({
        where: { itemGraficaId: f.materiaPrimaId, tipo: "SAIDA_PRODUCAO" },
      });
      expect(saidasProducao).toHaveLength(0);

      // Estoque do PRODUTO decrementado pela quantidade pedida (10).
      const produtoDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.produtoId } });
      expect(Number(produtoDepois.estoqueAtual)).toBe(90);

      const saidaAtendimento = await prisma.movimentacaoEstoque.findFirst({
        where: { itemGraficaId: f.produtoId, tipo: "SAIDA_ATENDIMENTO_PEDIDO" },
      });
      expect(saidaAtendimento).not.toBeNull();
      expect(Number(saidaAtendimento!.quantidade)).toBe(10);
      expect(saidaAtendimento!.pedidoId).toBe(f.pedidoId);
      expect(Number(saidaAtendimento!.custoUnitario)).toBeCloseTo(f.custoUnitarioPreProduzido!, 4);
      expect(Number(saidaAtendimento!.custoTotal)).toBeCloseTo(f.custoUnitarioPreProduzido! * 10, 2);

      const custoPedido = await prisma.custoPedido.findFirst({ where: { pedidoId: f.pedidoId } });
      expect(custoPedido).not.toBeNull();
      expect(custoPedido!.origem).toBe("PRODUTO_PRE_PRODUZIDO");
      expect(Number(custoPedido!.valor)).toBeCloseTo(f.custoUnitarioPreProduzido! * 10, 2);
      expect(custoPedido!.movimentacaoEstoqueId).toBe(saidaAtendimento!.id);
    },
    TIMEOUT_MS
  );

  it(
    "checkbox desmarcado (array vazio) = comportamento de hoje: consome matéria-prima normalmente, sem SAIDA_ATENDIMENTO_PEDIDO",
    async () => {
      const f = await criarFixture({ estoqueProduto: 100, quantidadeItem: 10 });

      // Item NÃO marcado pra atender do estoque continua exigindo a
      // confirmação de perda normal (validação pré-existente em
      // perda-fixa-producao.ts, não muda com esta feature) — uma por
      // item×ficha técnica, chave montarChavePerda(orcamentoItemId,
      // fichaTecnicaItemId).
      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f),
        JSON.stringify([
          { chave: montarChavePerda(f.orcamentoItemId, f.fichaTecnicaItemId), perdaAplicada: 0 },
        ]),
        { origemConfirmacao: "APP", operadorId: null },
        null,
        [] // nenhum item marcado
      );
      expect(resultado.ok).toBe(true);

      const materiaPrimaDepois = await prisma.itemGrafica.findUniqueOrThrow({
        where: { id: f.materiaPrimaId },
      });
      expect(Number(materiaPrimaDepois.estoqueAtual)).toBeCloseTo(1000 - f.quantidadePorUnidade * 10, 4);

      // Estoque pré-produzido do PRODUTO fica intocado — nada foi atendido dele.
      const produtoDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.produtoId } });
      expect(Number(produtoDepois.estoqueAtual)).toBe(100);

      const atendimentos = await prisma.movimentacaoEstoque.findMany({
        where: { itemGraficaId: f.produtoId, tipo: "SAIDA_ATENDIMENTO_PEDIDO" },
      });
      expect(atendimentos).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "estoque pré-produzido insuficiente (mesmo marcado): erro amigável, nada gravado",
    async () => {
      // Só 5 em estoque, pedido é de 10 — insuficiente.
      const f = await criarFixture({ estoqueProduto: 5, quantidadeItem: 10 });

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f),
        JSON.stringify([]),
        { origemConfirmacao: "APP", operadorId: null },
        null,
        [f.orcamentoItemId]
      );
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.mensagem).toContain("Estoque pré-produzido insuficiente");
      }

      // Nada foi gravado: pedido continua em CLICHE_FACA, estoque do produto
      // intocado, sem nenhuma movimentação.
      const pedidoDepois = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoDepois.status).toBe("CLICHE_FACA");
      const produtoDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.produtoId } });
      expect(Number(produtoDepois.estoqueAtual)).toBe(5);
      const movimentacoesPedido = await prisma.movimentacaoEstoque.findMany({
        where: { pedidoId: f.pedidoId },
      });
      expect(movimentacoesPedido).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "custo desconhecido (sem ENTRADA_PRODUCAO prévia): SAIDA_ATENDIMENTO_PEDIDO com custo null, sem CustoPedido (nunca inventa R$0,00)",
    async () => {
      const f = await criarFixture({ estoqueProduto: 100, quantidadeItem: 10, custoUnitarioPreProduzido: null });

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f),
        JSON.stringify([]),
        { origemConfirmacao: "APP", operadorId: null },
        null,
        [f.orcamentoItemId]
      );
      expect(resultado.ok).toBe(true);

      const saidaAtendimento = await prisma.movimentacaoEstoque.findFirst({
        where: { itemGraficaId: f.produtoId, tipo: "SAIDA_ATENDIMENTO_PEDIDO" },
      });
      expect(saidaAtendimento).not.toBeNull();
      expect(saidaAtendimento!.custoUnitario).toBeNull();
      expect(saidaAtendimento!.custoTotal).toBeNull();

      const custoPedido = await prisma.custoPedido.findFirst({ where: { pedidoId: f.pedidoId } });
      expect(custoPedido).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "concorrência: dois pedidos disputando o mesmo estoque pré-produzido — só um consegue",
    async () => {
      // 100 em estoque; dois pedidos de 60 cada (soma 120 > 100, cada um
      // isoladamente cabe) — exatamente um dos dois deve conseguir.
      const f1 = await criarFixture({ estoqueProduto: 100, quantidadeItem: 60 });
      // Segundo pedido no MESMO produto/estoque: cria um segundo orçamento+
      // pedido apontando pro mesmo produtoId da primeira fixture, evitando
      // duplicar o setup de matéria-prima/ficha técnica.
      const cliente2 = await prisma.cliente.create({
        data: { graficaId: f1.graficaId, nome: `Cliente 2 ${sufixo()}` },
      });
      const usuario2 = await prisma.usuario.findFirstOrThrow({ where: { graficaId: f1.graficaId } });
      const orcamento2 = await prisma.orcamento.create({
        data: {
          graficaId: f1.graficaId,
          clienteId: cliente2.id,
          usuarioId: usuario2.id,
          status: "APROVADO",
          total: 500,
        },
      });
      const orcamentoItem2 = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento2.id,
          itemGraficaId: f1.produtoId,
          quantidade: 60,
          precoUnitario: 50,
          precoTotal: 500,
        },
      });
      const pedido2 = await prisma.pedido.create({
        data: { graficaId: f1.graficaId, orcamentoId: orcamento2.id, status: "CLICHE_FACA" },
      });

      const f2: Fixture = { ...f1, orcamentoId: orcamento2.id, orcamentoItemId: orcamentoItem2.id, pedidoId: pedido2.id, quantidadeItem: 60 };

      const [r1, r2] = await Promise.all([
        avancarStatusPedido(
          pedidoParaAvanco(f1),
          JSON.stringify([]),
          { origemConfirmacao: "APP", operadorId: null },
          null,
          [f1.orcamentoItemId]
        ),
        avancarStatusPedido(
          pedidoParaAvanco(f2),
          JSON.stringify([]),
          { origemConfirmacao: "APP", operadorId: null },
          null,
          [f2.orcamentoItemId]
        ),
      ]);

      const resultados = [r1, r2];
      const sucessos = resultados.filter((r) => r.ok);
      const falhas = resultados.filter((r) => !r.ok);
      expect(sucessos).toHaveLength(1);
      expect(falhas).toHaveLength(1);

      const produtoDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f1.produtoId } });
      expect(Number(produtoDepois.estoqueAtual)).toBe(40);
    },
    TIMEOUT_MS
  );
});
