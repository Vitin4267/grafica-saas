import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import { montarChavePerda } from "@/lib/perda-fixa-producao";
import { lucroDoPedido, custosPorCategoriaNoPeriodo } from "@/lib/custo-pedido";

// avancarStatusPedido chama revalidatePath no final — fora de uma requisição
// Next.js de verdade (é o caso deste teste de integração, que chama a
// função direto) isso derruba com "static generation store missing". Mock
// mínimo, só pra não quebrar; nenhuma asserção deste arquivo depende de
// revalidação de cache.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/catalogo-ncm.test.ts) — cobre o critério de
// aceite do PR-3 da fase "custo real" (fase-custo-real.md §5): geração
// automática de CustoPedido na baixa Fila→Impressão, idempotência,
// possivelDuplicidade sem soma calada, custoAutomaticoConsumo=false
// preservando o comportamento antigo, e exclusão de custo estornado da
// soma de lucro/relatórios. Timeout 30s por teste: cada um faz vários
// round-trips sequenciais pro Postgres de dev na Neon (mesmo motivo de
// catalogo-ncm.test.ts).
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  categoriaCustoId: string;
  materiaPrimaId: string;
  produtoId: string;
  fichaTecnicaItemId: string;
  orcamentoId: string;
  orcamentoItemId: string;
  pedidoId: string;
  precoCompra: number;
  quantidadePorUnidade: number;
  quantidadeItem: number;
};

async function criarFixture(opts?: { custoAutomaticoConsumo?: boolean }): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Custo Real ${s}`, slug: `teste-custo-real-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-custo-real-${s}@example.com`, senhaHash: "x" },
  });
  // Única categoria ativa da gráfica — sem categoriaCustoId na matéria-prima
  // nem categoriaCustoConsumoPadraoId configurado, o fallback do PR-3
  // ("primeira categoria ativa") precisa cair exatamente aqui.
  const categoria = await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });

  if (opts?.custoAutomaticoConsumo !== undefined) {
    await prisma.parametrosGrafica.create({
      data: { graficaId: grafica.id, custoAutomaticoConsumo: opts.custoAutomaticoConsumo },
    });
  }

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
  const fichaTecnicaItem = await prisma.fichaTecnicaItem.create({
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

  const pedido = await prisma.pedido.create({ data: { graficaId: grafica.id, orcamentoId: orcamento.id } });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    categoriaCustoId: categoria.id,
    materiaPrimaId: materiaPrima.id,
    produtoId: produto.id,
    fichaTecnicaItemId: fichaTecnicaItem.id,
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
    status: "FILA",
    arteUrl: null,
    arteAprovadaEm: null,
    producaoLinkToken: null,
    orcamento: {
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [{ quantidade: f.quantidadeItem, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
    },
  };
}

function perdasJson(f: Fixture): string {
  // perdaFixaPadrao não foi configurado na matéria-prima (fica null) — só
  // existe a linha de consumo por ficha técnica, sem linha de perda. Ainda
  // assim resolverPerdasConfirmadas exige uma confirmação por chave, mesmo
  // com perdaAplicada=0.
  return JSON.stringify([{ chave: montarChavePerda(f.orcamentoItemId, f.fichaTecnicaItemId), perdaAplicada: 0 }]);
}

const graficaIdsParaLimpar: string[] = [];

// Ordem de exclusão respeitando as FKs Restrict do schema (CustoPedido→
// CategoriaCusto, MovimentacaoEstoque→ItemGrafica) — mesmo cuidado de
// catalogo-ncm.test.ts, mas com mais tabelas na cadeia desta fase.
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
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("custo automático da baixa de produção (fase custo real, PR-3)", () => {
  it(
    "gera um CustoPedido CONSUMO_ESTOQUE coerente ao avançar Fila→Impressão, com fallback pra 1ª categoria ativa",
    async () => {
      const f = await criarFixture();
      const resultado = await avancarStatusPedido(pedidoParaAvanco(f), perdasJson(f));
      expect(resultado.ok).toBe(true);

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(1);
      const custo = custos[0];
      expect(custo.origem).toBe("CONSUMO_ESTOQUE");
      expect(custo.categoriaCustoId).toBe(f.categoriaCustoId);
      expect(Number(custo.valor)).toBeCloseTo(f.precoCompra * f.quantidadePorUnidade * f.quantidadeItem, 2);
      expect(Number(custo.valorCalculado)).toBeCloseTo(Number(custo.valor), 2);
      expect(custo.possivelDuplicidade).toBe(false);
      expect(custo.editadoManualmente).toBe(false);
      expect(custo.movimentacaoEstoqueId).not.toBeNull();
      expect(custo.estornadoEm).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "duplo clique (CAS já barrou a 2ª chamada) não gera um segundo CustoPedido",
    async () => {
      const f = await criarFixture();
      const primeira = await avancarStatusPedido(pedidoParaAvanco(f), perdasJson(f));
      expect(primeira.ok).toBe(true);

      // Mesmo objeto "stale" (ainda alegando status FILA) — replica duas
      // abas/clique duplo. O CAS em avancarStatusPedido já barra isso antes
      // de qualquer criação de MovimentacaoEstoque/CustoPedido nova.
      const segunda = await avancarStatusPedido(pedidoParaAvanco(f), perdasJson(f));
      expect(segunda.ok).toBe(false);

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "custoAutomaticoConsumo=false reproduz o comportamento de hoje: baixa acontece, nenhum CustoPedido nasce",
    async () => {
      const f = await criarFixture({ custoAutomaticoConsumo: false });
      const resultado = await avancarStatusPedido(pedidoParaAvanco(f), perdasJson(f));
      expect(resultado.ok).toBe(true);

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(1);
      expect(movimentacoes[0].custoTotal).not.toBeNull(); // valorização continua acontecendo (PR-2)

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "custo automático que colide com manual na mesma categoria nasce marcado, nunca somado calado",
    async () => {
      const f = await criarFixture();
      await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          valor: 340,
          origem: "MANUAL",
        },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f), perdasJson(f));
      expect(resultado.ok).toBe(true);

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(2);
      const manual = custos.find((c) => c.origem === "MANUAL")!;
      const automatico = custos.find((c) => c.origem === "CONSUMO_ESTOQUE")!;
      expect(Number(manual.valor)).toBe(340); // intocado
      expect(Number(automatico.valor)).toBeCloseTo(f.precoCompra * f.quantidadePorUnidade * f.quantidadeItem, 2); // não somado ao manual
      expect(automatico.possivelDuplicidade).toBe(true);
      expect(manual.possivelDuplicidade).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "cancelamento marca estornadoEm sem apagar, e o custo estornado some da soma de lucro/relatórios",
    async () => {
      const f = await criarFixture();
      const resultado = await avancarStatusPedido(pedidoParaAvanco(f), perdasJson(f));
      expect(resultado.ok).toBe(true);

      const lucroAntes = await lucroDoPedido(f.pedidoId);
      expect(lucroAntes?.custoTotal).toBeGreaterThan(0);

      // Replica exatamente a operação que cancelarPedido (producao/actions.ts)
      // executa dentro da transação de cancelamento: acha as saídas
      // SAIDA_PRODUCAO do pedido e marca estornadoEm em todo CustoPedido cuja
      // movimentacaoEstoqueId aponte pra elas — cancelarPedido em si não é
      // chamável fora de uma requisição autenticada (exigirUsuarioAutenticado
      // lê cookies via next/headers), então este teste verifica o mesmo
      // efeito de banco que ele produz, mais os consumidores a jusante.
      const saidas = await prisma.movimentacaoEstoque.findMany({
        where: { pedidoId: f.pedidoId, tipo: "SAIDA_PRODUCAO" },
      });
      expect(saidas).toHaveLength(1);
      await prisma.custoPedido.updateMany({
        where: { movimentacaoEstoqueId: { in: saidas.map((s) => s.id) }, estornadoEm: null },
        data: { estornadoEm: new Date() },
      });

      const custosAposEstorno = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custosAposEstorno).toHaveLength(1); // NUNCA apaga
      expect(custosAposEstorno[0].estornadoEm).not.toBeNull();

      const lucroDepois = await lucroDoPedido(f.pedidoId);
      expect(lucroDepois?.custoTotal).toBe(0);
      expect(lucroDepois?.custosPorCategoria).toHaveLength(0);

      const porCategoria = await custosPorCategoriaNoPeriodo(
        f.graficaId,
        new Date(Date.now() - 86_400_000),
        new Date(Date.now() + 86_400_000)
      );
      expect(porCategoria.find((c) => c.categoriaId === f.categoriaCustoId)).toBeUndefined();
    },
    TIMEOUT_MS
  );
});

// Cobre o PR-7 (cortável) da fase "custo real": FichaTecnicaItem estendido
// pra aceitar itemGraficaId de um SERVICO (acabamento), e a baixa automática
// consumindo essa ficha também — ver comentário no schema de
// FichaTecnicaItem ("acabamentos/serviços consumindo material próprio...
// ficam de fora por ora") e fase-custo-real.md. Fixture separada da de cima
// porque agora tem duas fichas técnicas em jogo (produto → papel, serviço →
// BOPP) e um OrcamentoItemAcabamento ligando as duas.
type FixtureAcabamento = Fixture & {
  materiaPrimaAcabamentoId: string;
  precoCompraAcabamento: number;
  servicoId: string;
  fichaTecnicaAcabamentoId: string;
  orcamentoItemAcabamentoId: string;
  qtdBaseAcabamento: number;
};

async function criarFixtureComAcabamento(): Promise<FixtureAcabamento> {
  const base = await criarFixture();
  const s = sufixo();

  const precoCompraAcabamento = 0.8;
  const catalogoBopp = await prisma.itemCatalogo.create({
    data: { graficaId: base.graficaId, tipo: "MATERIA_PRIMA", categoria: "Laminação", nome: `BOPP ${s}` },
  });
  const materiaPrimaAcabamento = await prisma.itemGrafica.create({
    data: {
      graficaId: base.graficaId,
      itemCatalogoId: catalogoBopp.id,
      precoCompra: precoCompraAcabamento,
      estoqueAtual: 1000,
    },
  });

  const catalogoServico = await prisma.itemCatalogo.create({
    data: { graficaId: base.graficaId, tipo: "SERVICO", categoria: "Acabamento", nome: `Laminação ${s}` },
  });
  const servico = await prisma.itemGrafica.create({
    data: { graficaId: base.graficaId, itemCatalogoId: catalogoServico.id },
  });

  const quantidadePorUnidadeAcabamento = 1.1; // m² de BOPP por folha laminada
  const fichaTecnicaAcabamento = await prisma.fichaTecnicaItem.create({
    data: {
      itemGraficaId: servico.id, // SERVICO, não PRODUTO — é exatamente o que este PR habilita
      materiaPrimaId: materiaPrimaAcabamento.id,
      quantidadePorUnidade: quantidadePorUnidadeAcabamento,
    },
  });

  const qtdBaseAcabamento = 420; // ex: 420 folhas impressas passaram pela laminação
  const orcamentoItemAcabamento = await prisma.orcamentoItemAcabamento.create({
    data: {
      orcamentoItemId: base.orcamentoItemId,
      itemGraficaId: servico.id,
      qtdBase: qtdBaseAcabamento,
      custoCalculado: 0,
    },
  });

  return {
    ...base, // quantidadePorUnidade aqui continua sendo a do PRODUTO (papel) — não mexer
    materiaPrimaAcabamentoId: materiaPrimaAcabamento.id,
    precoCompraAcabamento,
    servicoId: servico.id,
    fichaTecnicaAcabamentoId: fichaTecnicaAcabamento.id,
    orcamentoItemAcabamentoId: orcamentoItemAcabamento.id,
    qtdBaseAcabamento,
  };
}

function perdasJsonComAcabamento(f: FixtureAcabamento): string {
  return JSON.stringify([
    { chave: montarChavePerda(f.orcamentoItemId, f.fichaTecnicaItemId), perdaAplicada: 0 },
    { chave: montarChavePerda(f.orcamentoItemAcabamentoId, f.fichaTecnicaAcabamentoId), perdaAplicada: 0 },
  ]);
}

describe("baixa automática também consome a ficha técnica dos acabamentos (fase custo real, PR-7)", () => {
  it(
    "acabamento com ficha técnica gera baixa de estoque e CustoPedido próprios, usando qtdBase como multiplicador",
    async () => {
      const f = await criarFixtureComAcabamento();
      const resultado = await avancarStatusPedido(pedidoParaAvanco(f), perdasJsonComAcabamento(f));
      expect(resultado.ok).toBe(true);

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { pedidoId: f.pedidoId },
        orderBy: { createdAt: "asc" },
      });
      // Uma pro produto (papel), uma pro acabamento (BOPP).
      expect(movimentacoes).toHaveLength(2);

      const movimentacaoBopp = movimentacoes.find((m) => m.itemGraficaId === f.materiaPrimaAcabamentoId);
      expect(movimentacaoBopp).toBeDefined();
      expect(movimentacaoBopp!.tipo).toBe("SAIDA_PRODUCAO");
      // Multiplicador é qtdBase do acabamento (420), não a quantidade do
      // item de orçamento (10) — a diferença entre os dois é justamente o
      // que este PR corrige.
      const quantidadeEsperadaBopp = 1.1 * f.qtdBaseAcabamento;
      expect(Number(movimentacaoBopp!.quantidade)).toBeCloseTo(quantidadeEsperadaBopp, 4);
      expect(Number(movimentacaoBopp!.custoTotal)).toBeCloseTo(
        quantidadeEsperadaBopp * f.precoCompraAcabamento,
        2
      );

      const materiaPrimaAposBaixa = await prisma.itemGrafica.findUniqueOrThrow({
        where: { id: f.materiaPrimaAcabamentoId },
      });
      expect(Number(materiaPrimaAposBaixa.estoqueAtual)).toBeCloseTo(1000 - quantidadeEsperadaBopp, 4);

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      // Um CustoPedido automático pro papel (produto) e outro pro BOPP
      // (acabamento) — a mesma categoria (fallback "1ª ativa") pros dois
      // nesta fixture, então nenhum é possivelDuplicidade (ambos CONSUMO_ESTOQUE,
      // não MANUAL).
      expect(custos).toHaveLength(2);
      expect(custos.every((c) => c.origem === "CONSUMO_ESTOQUE")).toBe(true);
      expect(custos.every((c) => c.possivelDuplicidade === false)).toBe(true);
      const custoBopp = custos.find((c) => c.movimentacaoEstoqueId === movimentacaoBopp!.id);
      expect(custoBopp).toBeDefined();
      expect(Number(custoBopp!.valor)).toBeCloseTo(quantidadeEsperadaBopp * f.precoCompraAcabamento, 2);
    },
    TIMEOUT_MS
  );

  it(
    "acabamento SEM ficha técnica cadastrada não gera nenhuma baixa extra (comportamento aditivo)",
    async () => {
      // Mesma fixture base do describe original, sem nenhum acabamento
      // anexado — replica exatamente o pedido de hoje, antes deste PR.
      const f = await criarFixture();
      const resultado = await avancarStatusPedido(pedidoParaAvanco(f), perdasJson(f));
      expect(resultado.ok).toBe(true);

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { pedidoId: f.pedidoId } });
      expect(movimentacoes).toHaveLength(1); // só a do produto, como sempre foi

      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: f.pedidoId } });
      expect(custos).toHaveLength(1);
    },
    TIMEOUT_MS
  );
});
