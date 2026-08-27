import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL) —
// espelha src/app/orcamento/[id]/actions.limite-credito.test.ts, mas pelo
// caminho PÚBLICO (link de aprovação sem sessão). Achado A6 da Parte 4 da
// auditoria de abrangência (2026-08-27): com
// ParametrosGrafica.bloqueiaAoUltrapassarLimiteCredito ligada, o bloqueio
// precisa valer nos dois caminhos — o link público é justamente o caminho
// sem revisão humana, então é ele quem mais precisa da trava. Sem a flag
// (comportamento de hoje), aprova normalmente e NENHUM aviso é populado —
// ResponderPublicoResult não tem esse campo de propósito (é o próprio
// cliente aprovando, não faz sentido avisar ele que está estourando o
// próprio limite).
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
  obterIpRequisicao: vi.fn(async () => "203.0.113.11"),
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

type Fixture = { graficaId: string; orcamentoId: string; token: string };

async function criarFixture(opts: {
  limiteCredito?: number;
  bloqueiaAoUltrapassarLimiteCredito?: boolean;
}): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Limite Credito Publico ${s}`, slug: `teste-limite-credito-pub-${s}` },
  });
  await prisma.assinaturaGrafica.create({
    data: { graficaId: grafica.id, status: "ATIVA" },
  });
  if (opts.bloqueiaAoUltrapassarLimiteCredito !== undefined) {
    await prisma.parametrosGrafica.create({
      data: {
        graficaId: grafica.id,
        bloqueiaAoUltrapassarLimiteCredito: opts.bloqueiaAoUltrapassarLimiteCredito,
      },
    });
  }

  const criador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Criador Pub ${s}`,
      email: `criador-limite-credito-pub-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });

  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente Pub ${s}`, limiteCredito: opts.limiteCredito ?? null },
  });

  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste Pub ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 100, precoCompra: 1 },
  });

  const token = `token-limite-credito-${s}`;
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: criador.id,
      status: "ENVIADO",
      total: 100,
      linkPublicoToken: token,
    },
  });
  await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: itemGrafica.id, quantidade: 1, precoUnitario: 100, precoTotal: 100 },
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

const graficaIdsParaLimpar: string[] = [];
const orcamentoIdsParaLimpar: string[] = [];

afterEach(async () => {
  if (orcamentoIdsParaLimpar.length > 0) {
    await prisma.tentativaRespostaOrcamento.deleteMany({
      where: { orcamentoId: { in: orcamentoIdsParaLimpar } },
    });
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
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.assinaturaGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("aprovação pública de orçamento — limite de crédito do cliente (achado A6 da Parte 4)", () => {
  it(
    "limite ultrapassado, flag desligada (default): aprova normalmente pelo link público",
    async () => {
      const f = await criarFixture({ limiteCredito: 50 });

      const resultado = await responderOrcamentoPublico(
        null,
        formDataDe({ token: f.token, decisao: "APROVADO", nome: "Cliente Teste" })
      );

      expect(resultado.ok).toBe(true);
      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "limite ultrapassado, flag ligada: aprovação recusada mesmo pelo link público (sem revisão humana)",
    async () => {
      const f = await criarFixture({ limiteCredito: 50, bloqueiaAoUltrapassarLimiteCredito: true });

      const resultado = await responderOrcamentoPublico(
        null,
        formDataDe({ token: f.token, decisao: "APROVADO", nome: "Cliente Teste" })
      );

      expect(resultado.ok).toBe(false);

      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).toBeNull();
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.status).toBe("ENVIADO");
    },
    TIMEOUT_MS
  );

  it(
    "dentro do limite: aprova normalmente pelo link público",
    async () => {
      const f = await criarFixture({ limiteCredito: 500, bloqueiaAoUltrapassarLimiteCredito: true });

      const resultado = await responderOrcamentoPublico(
        null,
        formDataDe({ token: f.token, decisao: "APROVADO", nome: "Cliente Teste" })
      );

      expect(resultado.ok).toBe(true);
      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).not.toBeNull();
    },
    TIMEOUT_MS
  );
});
