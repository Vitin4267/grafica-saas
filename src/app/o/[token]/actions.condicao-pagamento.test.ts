import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL) —
// espelha src/app/orcamento/[id]/actions.condicao-pagamento.test.ts, mas
// pelo caminho PÚBLICO (link de aprovação sem sessão). Achado A7 da Parte 4
// da auditoria de abrangência (2026-08-28): geração automática de
// ContaReceber precisa valer nos dois caminhos, senão metade das aprovações
// (as que acontecem pelo link público, sem revisão humana) continua cega.
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

vi.mock("@/lib/auth/ip", () => ({
  obterIpRequisicao: vi.fn(async () => "203.0.113.12"),
}));

import { responderOrcamentoPublico } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const APP_URL_ORIGINAL = process.env.APP_URL;
beforeAll(() => {
  process.env.APP_URL = "https://teste.example";
});
afterAll(() => {
  if (APP_URL_ORIGINAL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = APP_URL_ORIGINAL;
});

const graficaIdsParaLimpar: string[] = [];
const orcamentoIdsParaLimpar: string[] = [];

async function criarFixture(opts: { total: number; condicaoPagamentoId?: string | null }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Condicao Pagamento Pub ${s}`, slug: `teste-condicao-pagamento-pub-${s}` },
  });
  await prisma.assinaturaGrafica.create({ data: { graficaId: grafica.id, status: "ATIVA" } });

  const criador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Criador Pub ${s}`,
      email: `criador-condicao-pagamento-pub-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente Pub ${s}` } });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Pub ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: opts.total, precoCompra: 1 },
  });

  const token = `token-condicao-pagamento-${s}`;
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: criador.id,
      status: "ENVIADO",
      total: opts.total,
      linkPublicoToken: token,
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
  orcamentoIdsParaLimpar.push(orcamento.id);
  return { graficaId: grafica.id, orcamentoId: orcamento.id, token };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

afterEach(async () => {
  if (orcamentoIdsParaLimpar.length > 0) {
    await prisma.tentativaRespostaOrcamento.deleteMany({ where: { orcamentoId: { in: orcamentoIdsParaLimpar } } });
    orcamentoIdsParaLimpar.length = 0;
  }
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
    await prisma.assinaturaGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("aprovação pública de orçamento — geração automática de ContaReceber (achado A7 da Parte 4)", () => {
  it(
    "sem condicaoPagamentoId (default): aprova normal pelo link público, nenhuma ContaReceber é gerada",
    async () => {
      const f = await criarFixture({ total: 400 });

      const resultado = await responderOrcamentoPublico(
        null,
        formDataDe({ token: f.token, decisao: "APROVADO", nome: "Cliente Teste" })
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
    "condicaoPagamentoId com âncora APROVACAO, 1x à vista (0 dias): gera 1 ContaReceber com o total cheio",
    async () => {
      const f = await criarFixture({ total: 250 });
      const condicao = await prisma.condicaoPagamento.create({
        data: {
          graficaId: f.graficaId,
          nome: "1x à vista",
          ancora: "APROVACAO",
          parcelas: { create: [{ ordem: 1, percentual: 100, diasAposAncora: 0 }] },
        },
      });
      await prisma.orcamento.update({ where: { id: f.orcamentoId }, data: { condicaoPagamentoId: condicao.id } });

      const resultado = await responderOrcamentoPublico(
        null,
        formDataDe({ token: f.token, decisao: "APROVADO", nome: "Cliente Teste" })
      );

      expect(resultado.ok).toBe(true);
      const contas = await prisma.contaReceber.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(contas).toHaveLength(1);
      expect(Number(contas[0].valor)).toBeCloseTo(250, 2);

      // Achado A10 da Parte 5 (2026-08-30) — mesmo preenchimento de
      // clienteId no caminho público, ver espelho em
      // src/app/orcamento/[id]/actions.condicao-pagamento.test.ts.
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(contas[0].clienteId).toBe(orcamento.clienteId);
    },
    TIMEOUT_MS
  );
});
