import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.aviso-bloqueio.test.ts) — cobre o achado A6 da
// Parte 4 da auditoria de abrangência (2026-08-27): Cliente.limiteCredito
// não existia, então um cliente com contas a receber vencidas podia ter
// orçamento de qualquer valor aprovado sem nenhum aviso. Por padrão
// (ParametrosGrafica.bloqueiaAoUltrapassarLimiteCredito = false) é só um
// aviso não-bloqueante, mesmo espírito de bloqueadoParaVenda — ligada, vira
// bloqueio de verdade (mesmo espírito de descontoMaxSemAprovacao).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
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

async function criarFixture(opts: {
  limiteCredito?: number;
  bloqueiaAoUltrapassarLimiteCredito?: boolean;
  // Exposição pré-existente (ContaReceber PENDENTE de OUTRO orçamento já
  // aprovado do mesmo cliente) — simula parcela vencida/a vencer.
  exposicaoPreExistente?: number;
}) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Limite Credito ${s}`, slug: `teste-limite-credito-${s}` },
  });
  if (opts.bloqueiaAoUltrapassarLimiteCredito !== undefined) {
    await prisma.parametrosGrafica.create({
      data: {
        graficaId: grafica.id,
        bloqueiaAoUltrapassarLimiteCredito: opts.bloqueiaAoUltrapassarLimiteCredito,
      },
    });
  }
  const cliente = await prisma.cliente.create({
    data: {
      graficaId: grafica.id,
      nome: `Cliente ${s}`,
      limiteCredito: opts.limiteCredito ?? null,
    },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-limite-credito-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 100, precoCompra: 1 },
  });

  if (opts.exposicaoPreExistente) {
    const outroOrcamento = await prisma.orcamento.create({
      data: {
        graficaId: grafica.id,
        clienteId: cliente.id,
        usuarioId: dono.id,
        status: "APROVADO",
        total: opts.exposicaoPreExistente,
      },
    });
    await prisma.contaReceber.create({
      data: {
        graficaId: grafica.id,
        orcamentoId: outroOrcamento.id,
        descricao: "Parcela única",
        valor: opts.exposicaoPreExistente,
        vencimento: new Date("2026-01-01T00:00:00Z"),
        status: "PENDENTE",
      },
    });
  }

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "ENVIADO", total: 100 },
  });
  await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: itemGrafica.id, quantidade: 1, precoUnitario: 100, precoTotal: 100 },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, orcamentoId: orcamento.id };
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
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("aprovação de orçamento — limite de crédito do cliente (achado A6 da Parte 4)", () => {
  it(
    "sem limite configurado (cliente.limiteCredito null): aprova sem nenhum aviso — comportamento de hoje",
    async () => {
      const f = await criarFixture({});
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.aviso).toBeUndefined();

      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "limite ultrapassado, flag de bloqueio desligada (default): aprova mesmo assim, mas com aviso",
    async () => {
      // limiteCredito=50, orçamento de 100 — estoura mesmo sem nenhuma
      // exposição prévia. Nenhum ParametrosGrafica é criado de propósito:
      // exercita o fallback (parametros null → bloqueiaAoUltrapassarLimiteCredito
      // tratado como false), mesmo comportamento de uma gráfica que nunca
      // abriu Configurações.
      const f = await criarFixture({ limiteCredito: 50 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.aviso).toContain("limite de crédito");

      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "limite ultrapassado por exposição pré-existente (ContaReceber pendente de outro orçamento) + flag desligada: aviso",
    async () => {
      // limiteCredito=150; exposição prévia de 80 (parcela pendente de outro
      // orçamento já aprovado) + este orçamento de 100 = 180 > 150. Cobre
      // especificamente a soma via calcularExposicaoCreditoCliente, não só a
      // comparação contra o total deste orçamento sozinho.
      const f = await criarFixture({ limiteCredito: 150, exposicaoPreExistente: 80 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.aviso).toContain("limite de crédito");
    },
    TIMEOUT_MS
  );

  it(
    "limite ultrapassado, flag de bloqueio ligada: aprovação recusada, nenhum pedido criado",
    async () => {
      const f = await criarFixture({ limiteCredito: 50, bloqueiaAoUltrapassarLimiteCredito: true });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("limite");

      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).toBeNull();

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.status).toBe("ENVIADO");
    },
    TIMEOUT_MS
  );

  it(
    "limite dentro do teto (não ultrapassa): aprova sem aviso",
    async () => {
      const f = await criarFixture({ limiteCredito: 500 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.aviso).toBeUndefined();
    },
    TIMEOUT_MS
  );
});
