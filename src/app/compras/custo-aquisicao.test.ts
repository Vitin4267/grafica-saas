import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusCompra, type SolicitacaoParaTransicao } from "./status-transicao";
import type { StatusSolicitacaoCompra } from "@/lib/compras-status";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de status-transicao.test.ts) — cobre o achado A2 da
// auditoria de abrangência (Parte 3/Compras, 2026-09-06): custo de
// aquisição real (frete/IPI/ICMS creditável/desconto) precisa efetivamente
// entrar no custoUnitario/custoTotal da MovimentacaoEstoque gerada em
// RECEBIDO e no CustoPedido origem=COMPRA — não só existir como campo sem
// efeito nenhum (ver comentário "PONTO MAIS IMPORTANTE DO ACHADO" em
// status-transicao.ts).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260906150000_compras_tipo_e_custo_aquisicao/migration.sql
// tiver sido aplicada no banco (colunas valorFrete/valorIpi/
// valorIcmsCreditavel/valorDesconto em solicitacoes_compra ainda não
// existem até lá) — mesmo aviso de origem-solicitacao-compra.test.ts.
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
  itemGraficaId: string;
  pedidoId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Custo Aquisicao ${s}`, slug: `teste-custo-aquisicao-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-custo-aquisicao-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const categoria = await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, estoqueAtual: 0 },
  });
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
    itemGraficaId: itemGrafica.id,
    pedidoId: pedido.id,
  };
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

describe("avancarStatusCompra — custo de aquisição real (achado A2)", () => {
  it(
    "COMPRADO com frete/IPI/ICMS/desconto: RECEBIDO grava custoUnitario/custoTotal a partir do custo de aquisição, não só valorFinal",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 10,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      let atual = await solicitacaoParaTransicao(solicitacao.id);
      const aprovado = await avancarStatusCompra(atual, "APROVADO", { id: f.usuarioDonoId });
      expect(aprovado.ok).toBe(true);

      atual = await solicitacaoParaTransicao(solicitacao.id);
      // valorFinal 1000 + frete 100 + IPI 50 - ICMS 30 - desconto 20 = 1100
      const comprado = await avancarStatusCompra(atual, "COMPRADO", { id: f.usuarioDonoId }, {
        valorFinal: 1000,
        valorFrete: 100,
        valorIpi: 50,
        valorIcmsCreditavel: 30,
        valorDesconto: 20,
      });
      expect(comprado.ok).toBe(true);

      const solicitacaoComprada = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(Number(solicitacaoComprada.valorFrete)).toBe(100);
      expect(Number(solicitacaoComprada.valorIpi)).toBe(50);
      expect(Number(solicitacaoComprada.valorIcmsCreditavel)).toBe(30);
      expect(Number(solicitacaoComprada.valorDesconto)).toBe(20);

      atual = await solicitacaoParaTransicao(solicitacao.id);
      const recebido = await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, { quantidadeRecebida: 10 });
      expect(recebido.ok).toBe(true);

      const movimentacao = await prisma.movimentacaoEstoque.findFirstOrThrow({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      // custoAquisicaoTotal = 1100; custoUnitario = 1100 / 10 = 110
      expect(Number(movimentacao.custoTotal)).toBe(1100);
      expect(Number(movimentacao.custoUnitario)).toBe(110);
    },
    TIMEOUT_MS
  );

  it(
    "compatibilidade: COMPRADO sem frete/IPI/ICMS/desconto (undefined) calcula EXATAMENTE igual a antes desta feature",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 5,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      let atual = await solicitacaoParaTransicao(solicitacao.id);
      await avancarStatusCompra(atual, "APROVADO", { id: f.usuarioDonoId });

      atual = await solicitacaoParaTransicao(solicitacao.id);
      // dados sem valorFrete/valorIpi/valorIcmsCreditavel/valorDesconto —
      // mesma chamada que qualquer chamador anterior a esta feature faria.
      await avancarStatusCompra(atual, "COMPRADO", { id: f.usuarioDonoId }, { valorFinal: 250 });

      atual = await solicitacaoParaTransicao(solicitacao.id);
      await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, { quantidadeRecebida: 5 });

      const movimentacao = await prisma.movimentacaoEstoque.findFirstOrThrow({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      // custoUnitario = valorFinal / quantidade = 250 / 5 = 50 (fórmula de sempre)
      expect(Number(movimentacao.custoTotal)).toBe(250);
      expect(Number(movimentacao.custoUnitario)).toBe(50);
    },
    TIMEOUT_MS
  );

  it(
    "CustoPedido origem=COMPRA (compra PEDIDO_ESPECIFICO) usa o custo de aquisição real, não só valorFinal",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 10,
          origem: "PEDIDO_ESPECIFICO",
          pedidoId: f.pedidoId,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      let atual = await solicitacaoParaTransicao(solicitacao.id);
      await avancarStatusCompra(atual, "APROVADO", { id: f.usuarioDonoId });

      atual = await solicitacaoParaTransicao(solicitacao.id);
      // valorFinal 500 + frete 50 - desconto 10 = 540
      await avancarStatusCompra(atual, "COMPRADO", { id: f.usuarioDonoId }, {
        valorFinal: 500,
        valorFrete: 50,
        valorDesconto: 10,
      });

      atual = await solicitacaoParaTransicao(solicitacao.id);
      await avancarStatusCompra(atual, "RECEBIDO", { id: f.usuarioDonoId }, { quantidadeRecebida: 10 });

      const custo = await prisma.custoPedido.findUnique({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(custo).not.toBeNull();
      expect(Number(custo!.valor)).toBe(540);
    },
    TIMEOUT_MS
  );
});
