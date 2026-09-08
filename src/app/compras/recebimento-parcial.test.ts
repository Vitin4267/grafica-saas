import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusCompra, type SolicitacaoParaTransicao } from "./status-transicao";
import type { StatusSolicitacaoCompra } from "@/lib/compras-status";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de status-transicao.test.ts/custo-aquisicao.test.ts) — cobre
// o achado A7 da auditoria de abrangência (Parte 3/Compras,
// pesquisa-abrangencia-modulos.md): recebimento parcial e divergência.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260907120000_compras_recebimento_parcial/migration.sql
// tiver sido aplicada no banco (StatusSolicitacaoCompra.RECEBIDO_PARCIAL e
// as colunas quantidadeRecebida/valorNotaFiscal/divergenciaObservacao em
// solicitacoes_compra ainda não existem até lá).
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
    data: { nome: `Teste Recebimento Parcial ${s}`, slug: `teste-recebimento-parcial-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-recebimento-parcial-${s}@example.com`,
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
    tipoCompra: solicitacao.tipoCompra,
    valorFrete: solicitacao.valorFrete,
    valorIpi: solicitacao.valorIpi,
    valorIcmsCreditavel: solicitacao.valorIcmsCreditavel,
    valorDesconto: solicitacao.valorDesconto,
    quantidadeRecebida: solicitacao.quantidadeRecebida,
  };
}

// SOLICITADO→APROVADO→COMPRADO, parando ANTES de RECEBIDO — os testes
// abaixo controlam a(s) confirmação(ões) de recebimento na mão, pra poder
// checar o estado intermediário (RECEBIDO_PARCIAL).
async function avancarAteComprado(solicitacaoId: string, usuarioId: string, valorFinal: number) {
  for (const proximo of ["APROVADO", "COMPRADO"] as StatusSolicitacaoCompra[]) {
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

describe("avancarStatusCompra — recebimento parcial e divergência (achado A7)", () => {
  it(
    "recebimento total de uma vez: vira RECEBIDO direto, quantidadeRecebida = quantidade — zero regressão",
    async () => {
      const f = await criarFixture();
      const item = await criarItemGrafica(f, 10);
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: { graficaId: f.graficaId, itemGraficaId: item.id, quantidade: 20, usuarioSolicitanteId: f.usuarioDonoId },
      });
      await avancarAteComprado(solicitacao.id, f.usuarioDonoId, 1000);

      const atual = await solicitacaoParaTransicao(solicitacao.id);
      const resultado = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, { quantidadeRecebida: 20 });
      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.proximoStatus).toBe("RECEBIDO");

      const solicitacaoDepois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(solicitacaoDepois.status).toBe("RECEBIDO");
      expect(Number(solicitacaoDepois.quantidadeRecebida)).toBe(20);

      const itemDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: item.id } });
      expect(Number(itemDepois.estoqueAtual)).toBe(30); // 10 + 20

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      expect(movimentacoes).toHaveLength(1);
      expect(Number(movimentacoes[0].quantidade)).toBe(20);
      expect(Number(movimentacoes[0].custoTotal)).toBe(1000);
    },
    TIMEOUT_MS
  );

  it(
    "recebimento parcial: vira RECEBIDO_PARCIAL, MovimentacaoEstoque só com a quantidade parcial",
    async () => {
      const f = await criarFixture();
      const item = await criarItemGrafica(f, 0);
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: { graficaId: f.graficaId, itemGraficaId: item.id, quantidade: 20, usuarioSolicitanteId: f.usuarioDonoId },
      });
      await avancarAteComprado(solicitacao.id, f.usuarioDonoId, 1000);

      const atual = await solicitacaoParaTransicao(solicitacao.id);
      const resultado = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, {
        quantidadeRecebida: 12,
        divergenciaObservacao: "Fornecedor mandou só uma parte, resto chega semana que vem",
      });
      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.proximoStatus).toBe("RECEBIDO_PARCIAL");

      const solicitacaoDepois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(solicitacaoDepois.status).toBe("RECEBIDO_PARCIAL");
      expect(Number(solicitacaoDepois.quantidadeRecebida)).toBe(12);
      expect(solicitacaoDepois.divergenciaObservacao).toContain("Fornecedor mandou só uma parte");
      // Ainda não fechou — CustoPedido/ContratoFornecimento não devem ter
      // disparado nesta confirmação intermediária.
      expect(solicitacaoDepois.recebidoEm).not.toBeNull(); // "data do último recebimento" já setada

      const itemDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: item.id } });
      expect(Number(itemDepois.estoqueAtual)).toBe(12); // 0 + 12, não os 20 inteiros

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      expect(movimentacoes).toHaveLength(1);
      expect(Number(movimentacoes[0].quantidade)).toBe(12);
      // custoUnitario = 1000/20 = 50; custoTotal deste lote = 50 * 12 = 600
      expect(Number(movimentacoes[0].custoUnitario)).toBe(50);
      expect(Number(movimentacoes[0].custoTotal)).toBe(600);

      const custo = await prisma.custoPedido.findMany({ where: { graficaId: f.graficaId } });
      expect(custo).toHaveLength(0); // sem pedidoId nesta solicitação — nada a checar de qualquer forma
    },
    TIMEOUT_MS
  );

  it(
    "segundo recebimento completa o restante: nova MovimentacaoEstoque, soma bate, vira RECEBIDO — CustoPedido só dispara no fechamento",
    async () => {
      const f = await criarFixture();
      const item = await criarItemGrafica(f, 5);
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: item.id,
          quantidade: 20,
          origem: "PEDIDO_ESPECIFICO",
          pedidoId: f.pedidoId,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });
      await avancarAteComprado(solicitacao.id, f.usuarioDonoId, 1000);

      // Primeira confirmação: 12 de 20 — fica RECEBIDO_PARCIAL.
      let atual = await solicitacaoParaTransicao(solicitacao.id);
      const primeira = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, {
        quantidadeRecebida: 12,
        divergenciaObservacao: "Entrega parcial combinada com o fornecedor",
      });
      expect(primeira.ok).toBe(true);
      if (primeira.ok) expect(primeira.proximoStatus).toBe("RECEBIDO_PARCIAL");

      // CustoPedido NÃO deve existir ainda — só no fechamento.
      const custoAntesDoFechamento = await prisma.custoPedido.findUnique({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      expect(custoAntesDoFechamento).toBeNull();

      // Segunda confirmação: reabre a partir de RECEBIDO_PARCIAL, restam 8 —
      // informa exatamente o restante esperado (sem divergência desta vez).
      atual = await solicitacaoParaTransicao(solicitacao.id);
      expect(atual.status).toBe("RECEBIDO_PARCIAL");
      const segunda = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, { quantidadeRecebida: 8 });
      expect(segunda.ok).toBe(true);
      if (segunda.ok) expect(segunda.proximoStatus).toBe("RECEBIDO");

      const solicitacaoFinal = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(solicitacaoFinal.status).toBe("RECEBIDO");
      expect(Number(solicitacaoFinal.quantidadeRecebida)).toBe(20); // 12 + 8

      const itemDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: item.id } });
      expect(Number(itemDepois.estoqueAtual)).toBe(25); // 5 + 12 + 8

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { solicitacaoCompraId: solicitacao.id },
        orderBy: { createdAt: "asc" },
      });
      expect(movimentacoes).toHaveLength(2); // uma por confirmação — a @unique de solicitacaoCompraId foi removida
      expect(Number(movimentacoes[0].quantidade)).toBe(12);
      expect(Number(movimentacoes[1].quantidade)).toBe(8);
      // custoUnitario constante entre as duas (1000/20 = 50); soma dos
      // custoTotal prorateados bate com o custo da nota inteira (1000).
      expect(Number(movimentacoes[0].custoUnitario)).toBe(50);
      expect(Number(movimentacoes[1].custoUnitario)).toBe(50);
      expect(Number(movimentacoes[0].custoTotal) + Number(movimentacoes[1].custoTotal)).toBe(1000);

      // CustoPedido é gerado exatamente UMA vez, no fechamento, com o valor
      // da nota INTEIRA (não só o último lote de 8).
      const custoFinal = await prisma.custoPedido.findUnique({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(custoFinal).not.toBeNull();
      expect(custoFinal!.origem).toBe("COMPRA");
      expect(Number(custoFinal!.valor)).toBe(1000);
    },
    TIMEOUT_MS
  );

  it(
    "tipoCompra != MATERIA_PRIMA: recebimento parcial nunca gera MovimentacaoEstoque, mesma regra de sempre",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          tipoCompra: "SERVICO_TERCEIRIZADO",
          descricaoLivre: "Clichê terceirizado",
          quantidade: 4,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });
      await avancarAteComprado(solicitacao.id, f.usuarioDonoId, 200);

      // Primeira confirmação parcial (2 de 4).
      let atual = await solicitacaoParaTransicao(solicitacao.id);
      const primeira = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, {
        quantidadeRecebida: 2,
        divergenciaObservacao: "Só metade entregue por ora",
      });
      expect(primeira.ok).toBe(true);
      if (primeira.ok) expect(primeira.proximoStatus).toBe("RECEBIDO_PARCIAL");

      let movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(movimentacoes).toHaveLength(0); // nunca gera, tipoCompra != MATERIA_PRIMA

      // Segunda confirmação completa o restante (2 de 4).
      atual = await solicitacaoParaTransicao(solicitacao.id);
      const segunda = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, { quantidadeRecebida: 2 });
      expect(segunda.ok).toBe(true);
      if (segunda.ok) expect(segunda.proximoStatus).toBe("RECEBIDO");

      movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(movimentacoes).toHaveLength(0); // continua nunca gerando, mesmo completo

      const solicitacaoFinal = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(solicitacaoFinal.status).toBe("RECEBIDO");
      expect(Number(solicitacaoFinal.quantidadeRecebida)).toBe(4);
    },
    TIMEOUT_MS
  );

  it(
    "divergência sem observação é rejeitada; com observação é aceita e persistida",
    async () => {
      const f = await criarFixture();
      const item = await criarItemGrafica(f, 0);
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: { graficaId: f.graficaId, itemGraficaId: item.id, quantidade: 10, usuarioSolicitanteId: f.usuarioDonoId },
      });
      await avancarAteComprado(solicitacao.id, f.usuarioDonoId, 500);

      const atual = await solicitacaoParaTransicao(solicitacao.id);

      // Sem quantidadeRecebida nenhuma: rejeitado.
      const semQuantidade = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, {});
      expect(semQuantidade.ok).toBe(false);

      // Quantidade diferente do restante esperado (10) sem observação: rejeitado.
      const semObservacao = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, { quantidadeRecebida: 7 });
      expect(semObservacao.ok).toBe(false);

      // Mesma divergência, agora com observação: aceito.
      const comObservacao = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, {
        quantidadeRecebida: 7,
        divergenciaObservacao: "Chegaram só 7 caixas, resto em falta no fornecedor",
      });
      expect(comObservacao.ok).toBe(true);

      const solicitacaoDepois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(solicitacaoDepois.status).toBe("RECEBIDO_PARCIAL");
      expect(solicitacaoDepois.divergenciaObservacao).toContain("Chegaram só 7 caixas");
    },
    TIMEOUT_MS
  );
});
