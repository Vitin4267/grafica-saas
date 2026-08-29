import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { dataInputParaUTC, hojeBrasiliaInputValue } from "@/lib/data";
import { garantirCondicoesPagamentoPadrao } from "@/lib/condicao-pagamento";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.credito-cliente.test.ts) — cobre o achado A7 da
// Parte 4 da auditoria de abrangência (2026-08-28): geração automática de
// ContaReceber a partir de Orcamento.condicaoPagamentoId, só pra âncora
// APROVACAO (ver src/lib/condicao-pagamento.ts pro resto do escopo/gap).
// FALHA ESPERADA até a migration 20260828110000_condicao_pagamento ser
// aplicada ao banco.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    fn();
  },
}));

vi.mock("@/lib/auth/session", () => ({
  exigirUsuarioAutenticado: vi.fn(),
}));
vi.mock("@/lib/auth/email-verificacao", () => ({
  exigirEmailVerificado: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/assinatura", () => ({
  exigirAssinaturaAtiva: vi.fn(async () => {}),
}));

import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { atualizarStatusOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(opts: { total: number; condicaoPagamentoId?: string | null }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Condicao Pagamento ${s}`, slug: `teste-condicao-pagamento-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-condicao-pagamento-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: opts.total, precoCompra: 1 },
  });
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: dono.id,
      status: "ENVIADO",
      total: opts.total,
      condicaoPagamentoId: opts.condicaoPagamentoId ?? null,
    },
  });
  await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: itemGrafica.id,
      quantidade: 1,
      precoUnitario: opts.total,
      precoTotal: opts.total,
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, orcamentoId: orcamento.id };
}

async function criarCondicao(
  graficaId: string,
  opts: {
    nome: string;
    ancora: "APROVACAO" | "EMISSAO_NOTA" | "ENTREGA" | "OUTRO";
    acrescimoPercent?: number;
    parcelas: { ordem: number; percentual: number; diasAposAncora: number }[];
  }
) {
  return prisma.condicaoPagamento.create({
    data: {
      graficaId,
      nome: opts.nome,
      ancora: opts.ancora,
      acrescimoPercent: opts.acrescimoPercent ?? null,
      parcelas: { create: opts.parcelas },
    },
  });
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.comissao.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.condicaoPagamentoParcela.deleteMany({ where: { condicaoPagamento: { graficaId } } });
    await prisma.condicaoPagamento.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("aprovação de orçamento — geração automática de ContaReceber (achado A7 da Parte 4)", () => {
  it(
    "sem condicaoPagamentoId (default): aprova normal, nenhuma ContaReceber é gerada — comportamento de hoje preservado",
    async () => {
      const f = await criarFixture({ total: 500 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );

      expect(resultado.ok).toBe(true);
      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).not.toBeNull();
      const contas = await prisma.contaReceber.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(contas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "condicaoPagamentoId com âncora APROVACAO, 50%+50% em 0/30 dias: gera 2 ContaReceber somando o total, vencimentos corretos",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Condicao 5050 ${s}`, slug: `teste-condicao-5050-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      const condicao = await criarCondicao(grafica.id, {
        nome: "Entrada + saldo em 30 dias",
        ancora: "APROVACAO",
        parcelas: [
          { ordem: 1, percentual: 50, diasAposAncora: 0 },
          { ordem: 2, percentual: 50, diasAposAncora: 30 },
        ],
      });

      const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
      const dono = await prisma.usuario.create({
        data: {
          graficaId: grafica.id,
          nome: `Dono ${s}`,
          email: `dono-5050-${s}@example.com`,
          senhaHash: "x",
          papel: "DONO",
        },
      });
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto ${s}` },
      });
      const itemGrafica = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 200, precoCompra: 1 },
      });
      const orcamento = await prisma.orcamento.create({
        data: {
          graficaId: grafica.id,
          clienteId: cliente.id,
          usuarioId: dono.id,
          status: "ENVIADO",
          total: 200,
          condicaoPagamentoId: condicao.id,
        },
      });
      await prisma.orcamentoItem.create({
        data: { orcamentoId: orcamento.id, itemGraficaId: itemGrafica.id, quantidade: 1, precoUnitario: 200, precoTotal: 200 },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(dono as never);

      const antesDaAprovacao = new Date();
      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: orcamento.id, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const contas = await prisma.contaReceber.findMany({
        where: { orcamentoId: orcamento.id },
        orderBy: { vencimento: "asc" },
      });
      expect(contas).toHaveLength(2);
      expect(contas.every((c) => c.status === "PENDENTE")).toBe(true);

      const somaTotal = contas.reduce((soma, c) => soma + Number(c.valor), 0);
      expect(somaTotal).toBeCloseTo(200, 2);
      expect(Number(contas[0].valor)).toBeCloseTo(100, 2);
      expect(Number(contas[1].valor)).toBeCloseTo(100, 2);

      const diaBase = dataInputParaUTC(hojeBrasiliaInputValue(antesDaAprovacao));
      expect(contas[0].vencimento.getTime()).toBe(diaBase.getTime());
      expect(contas[1].vencimento.getTime()).toBe(diaBase.getTime() + 30 * 86_400_000);

      expect(contas[0].descricao).toContain("Entrada + saldo em 30 dias");
    },
    TIMEOUT_MS
  );

  it(
    "condicaoPagamentoId com âncora APROVACAO e acrescimoPercent (30/60/90 com 2%): aplica o acréscimo antes de dividir, última parcela absorve o arredondamento",
    async () => {
      const f = await criarFixture({ total: 1000 });
      const condicao = await criarCondicao(f.graficaId, {
        nome: "30/60/90 com 2% de acréscimo",
        ancora: "APROVACAO",
        acrescimoPercent: 2,
        parcelas: [
          { ordem: 1, percentual: 33.34, diasAposAncora: 30 },
          { ordem: 2, percentual: 33.33, diasAposAncora: 60 },
          { ordem: 3, percentual: 33.33, diasAposAncora: 90 },
        ],
      });
      await prisma.orcamento.update({ where: { id: f.orcamentoId }, data: { condicaoPagamentoId: condicao.id } });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const contas = await prisma.contaReceber.findMany({
        where: { orcamentoId: f.orcamentoId },
        orderBy: { vencimento: "asc" },
      });
      expect(contas).toHaveLength(3);
      // Total original 1000 + 2% = 1020.00 — nunca 1000 (o acréscimo tem que
      // ter sido aplicado ANTES de dividir nas parcelas).
      const somaTotal = contas.reduce((soma, c) => soma + Number(c.valor), 0);
      expect(somaTotal).toBeCloseTo(1020, 2);
    },
    TIMEOUT_MS
  );

  it(
    "condicaoPagamentoId com âncora EMISSAO_NOTA (gap remanescente documentado): aprova e cria Pedido normalmente, mas nenhuma ContaReceber é gerada",
    async () => {
      const f = await criarFixture({ total: 300 });
      const condicao = await criarCondicao(f.graficaId, {
        nome: "1x faturado 30 dias",
        ancora: "EMISSAO_NOTA",
        parcelas: [{ ordem: 1, percentual: 100, diasAposAncora: 30 }],
      });
      await prisma.orcamento.update({ where: { id: f.orcamentoId }, data: { condicaoPagamentoId: condicao.id } });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);
      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).not.toBeNull();

      const contas = await prisma.contaReceber.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(contas).toHaveLength(0);

      // A condição continua vinculada ao orçamento — só o gatilho automático
      // que ainda não existe pra esta âncora (ver comentário em
      // src/lib/condicao-pagamento.ts).
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.condicaoPagamentoId).toBe(condicao.id);
    },
    TIMEOUT_MS
  );
});

describe("garantirCondicoesPagamentoPadrao (bootstrap lazy — achado A7 da Parte 4)", () => {
  it(
    "gráfica sem nenhuma condição: cria as 4 condições sugeridas com parcelas",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Bootstrap Condicao ${s}`, slug: `teste-bootstrap-condicao-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      await garantirCondicoesPagamentoPadrao(grafica.id);

      const condicoes = await prisma.condicaoPagamento.findMany({
        where: { graficaId: grafica.id },
        include: { parcelas: true },
      });
      expect(condicoes).toHaveLength(4);
      for (const condicao of condicoes) {
        const somaPercentual = condicao.parcelas.reduce((soma, p) => soma + Number(p.percentual), 0);
        expect(somaPercentual).toBeCloseTo(100, 2);
      }
    },
    TIMEOUT_MS
  );

  it(
    "idempotente: não recria se a gráfica já tem QUALQUER condição cadastrada (mesmo custom, sem nenhuma das 4 sugeridas)",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Bootstrap Condicao Custom ${s}`, slug: `teste-bootstrap-condicao-custom-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      await prisma.condicaoPagamento.create({
        data: { graficaId: grafica.id, nome: "Condição já existente", ancora: "OUTRO", parcelas: { create: [{ ordem: 1, percentual: 100, diasAposAncora: 15 }] } },
      });

      await garantirCondicoesPagamentoPadrao(grafica.id);

      const condicoes = await prisma.condicaoPagamento.findMany({ where: { graficaId: grafica.id } });
      expect(condicoes).toHaveLength(1);
      expect(condicoes[0].nome).toBe("Condição já existente");
    },
    TIMEOUT_MS
  );
});
