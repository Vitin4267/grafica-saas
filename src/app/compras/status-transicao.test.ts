import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusCompra, type SolicitacaoParaTransicao } from "./status-transicao";
import type { StatusSolicitacaoCompra } from "@/lib/compras-status";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de alcada-aprovacao.test.ts/origem-solicitacao-compra.test.ts)
// — cobre o achado N15 da auditoria de abrangência (Parte 7,
// pesquisa-abrangencia-modulos.md): receber uma compra (status RECEBIDO) de
// um item com estoqueAtual=null (convenção do projeto pra "sem controle de
// estoque", a mesma respeitada pela baixa de produção em
// src/app/producao/status-transicao.ts) não pode fazer o item "nascer" com
// saldo — a baixa/alta de estoque deve ser pulada, mas o custo da compra
// (CustoPedido origem=COMPRA, quando há pedidoId) continua sendo registrado
// normalmente.
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
  usuarioDonoId: string;
  categoriaCustoId: string;
  pedidoId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Estoque Compra ${s}`, slug: `teste-estoque-compra-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-estoque-compra-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const categoria = await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "APROVADO", total: 500 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "ARTE" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    categoriaCustoId: categoria.id,
    pedidoId: pedido.id,
  };
}

async function criarItemGrafica(fixture: Fixture, estoqueAtual: number | null) {
  const s = sufixo();
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: fixture.graficaId, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel ${s}` },
  });
  return prisma.itemGrafica.create({
    data: { graficaId: fixture.graficaId, itemCatalogoId: catalogo.id, estoqueAtual },
  });
}

async function criarVariante(itemGraficaId: string, estoqueAtual: number | null) {
  return prisma.varianteMateriaPrima.create({
    data: { itemGraficaId, rotulo: "2mm", precoCompra: 10, estoqueAtual },
  });
}

async function solicitacaoParaTransicao(solicitacaoId: string): Promise<SolicitacaoParaTransicao> {
  const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacaoId } });
  return {
    id: solicitacao.id,
    graficaId: solicitacao.graficaId,
    status: solicitacao.status,
    itemGraficaId: solicitacao.itemGraficaId,
    varianteId: solicitacao.varianteId,
    quantidade: solicitacao.quantidade,
    valorEstimado: solicitacao.valorEstimado,
    valorFinal: solicitacao.valorFinal,
    fornecedorId: solicitacao.fornecedorId,
    documento: solicitacao.documento,
    pedidoId: solicitacao.pedidoId,
    contratoFornecimentoId: solicitacao.contratoFornecimentoId,
  };
}

// SOLICITADO→APROVADO→COMPRADO→RECEBIDO, sem cotação (mesmo caminho "direto"
// de origem-solicitacao-compra.test.ts) — usada por todos os testes abaixo.
async function avancarAteRecebido(solicitacaoId: string, usuarioId: string, valorFinal: number) {
  for (const proximo of ["APROVADO", "COMPRADO", "RECEBIDO"] as StatusSolicitacaoCompra[]) {
    const atual = await solicitacaoParaTransicao(solicitacaoId);
    const dados = proximo === "COMPRADO" ? { valorFinal } : {};
    const resultado = await avancarStatusCompra(atual, proximo, { id: usuarioId }, dados);
    if (!resultado.ok) throw new Error(`Falha avançando pra ${proximo}: ${resultado.mensagem}`);
  }
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.solicitacaoCompra.deleteMany({ where: { graficaId } });
    await prisma.varianteMateriaPrima.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("avancarStatusCompra — RECEBIDO respeita item sem controle de estoque (achado N15)", () => {
  it(
    "item com estoqueAtual=null: continua null após RECEBIDO, nenhuma MovimentacaoEstoque é criada, mas o custo da compra é registrado normalmente",
    async () => {
      const f = await criarFixture();
      const item = await criarItemGrafica(f, null); // sem controle de estoque
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: item.id,
          quantidade: 5,
          origem: "PEDIDO_ESPECIFICO",
          pedidoId: f.pedidoId,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 350);

      const itemDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: item.id } });
      expect(itemDepois.estoqueAtual).toBeNull(); // continua sem controle, não "nasceu" com saldo

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      expect(movimentacoes).toHaveLength(0); // nenhuma MovimentacaoEstoque criada

      const custo = await prisma.custoPedido.findUnique({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(custo).not.toBeNull(); // custo da compra continua registrado normalmente
      expect(custo!.origem).toBe("COMPRA");
      expect(custo!.pedidoId).toBe(f.pedidoId);
      expect(Number(custo!.valor)).toBe(350);

      const solicitacaoDepois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(solicitacaoDepois.status).toBe("RECEBIDO"); // a transição de status em si não foi afetada
    },
    TIMEOUT_MS
  );

  it(
    "item com estoqueAtual numérico: RECEBIDO soma a quantidade e cria MovimentacaoEstoque — regressão zero",
    async () => {
      const f = await criarFixture();
      const item = await criarItemGrafica(f, 10); // COM controle de estoque
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: item.id,
          quantidade: 5,
          origem: "PEDIDO_ESPECIFICO",
          pedidoId: f.pedidoId,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 350);

      const itemDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: item.id } });
      expect(Number(itemDepois.estoqueAtual)).toBe(15); // 10 + 5, comportamento de sempre

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      expect(movimentacoes).toHaveLength(1);
      expect(movimentacoes[0].tipo).toBe("ENTRADA_COMPRA");
      expect(Number(movimentacoes[0].quantidade)).toBe(5);

      const custo = await prisma.custoPedido.findUnique({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(custo).not.toBeNull();
      expect(Number(custo!.valor)).toBe(350);
    },
    TIMEOUT_MS
  );

  it(
    "variante com estoqueAtual=null: mesmo guard se aplica pelo caminho de VarianteMateriaPrima",
    async () => {
      const f = await criarFixture();
      const item = await criarItemGrafica(f, 0); // ItemGrafica "pai" tem saldo próprio irrelevante aqui
      const variante = await criarVariante(item.id, null); // variante SEM controle de estoque
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: item.id,
          varianteId: variante.id,
          quantidade: 5,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 100);

      const varianteDepois = await prisma.varianteMateriaPrima.findUniqueOrThrow({ where: { id: variante.id } });
      expect(varianteDepois.estoqueAtual).toBeNull();

      const itemPaiDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: item.id } });
      expect(Number(itemPaiDepois.estoqueAtual)).toBe(0); // o "pai" nunca é tocado no caminho com variante

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      expect(movimentacoes).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
