import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.custo-auditoria.test.ts) — cobre o achado N2 da
// auditoria de código (auditoria-codigo-2026-09-02.md / Parte 8): cancelar
// pedido não desfazia ContaReceber nem Comissao, e o orçamento continuava
// contando como faturamento em buscarVisaoGeralNegocio mesmo depois do
// pedido cancelado.
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
vi.mock("@/lib/webhook-automacao", () => ({
  buscarAutomacaoGrafica: vi.fn(async () => ({ webhookUrl: null, notificarStatusMudou: false })),
  dispararEventoAutomacao: vi.fn(async () => {}),
}));

import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { cancelarPedido } from "./actions";
import { buscarVisaoGeralNegocio } from "@/lib/meu-negocio";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  orcamentoId: string;
  pedidoId: string;
};

async function criarFixture(opts: { comValorFaturamento?: number } = {}): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Cancelamento Financeiro ${s}`, slug: `teste-cancel-financeiro-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-cancel-financeiro-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      comissaoPercent: 5,
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: usuario.id,
      status: "APROVADO",
      total: opts.comValorFaturamento ?? 1000,
    },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "ARTE" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return { graficaId: grafica.id, usuarioId: usuario.id, orcamentoId: orcamento.id, pedidoId: pedido.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.comissao.deleteMany({ where: { graficaId } });
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("cancelarPedido desfaz financeiro (achado N2)", () => {
  it(
    "cancela ContaReceber PENDENTE e Comissao PENDENTE do orçamento, mas preserva conta PARCIAL",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const contaPendente = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Parcela 1/1",
          valor: 1000,
          vencimento: new Date(),
          status: "PENDENTE",
        },
      });
      // Uma segunda conta, já com baixa parcial — não deve ser tocada, pois
      // já existe dinheiro real recebido nela.
      const contaParcial = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Parcela extra",
          valor: 500,
          vencimento: new Date(),
          status: "PARCIAL",
        },
      });
      const comissao = await prisma.comissao.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          usuarioId: f.usuarioId,
          baseCalculo: "VALOR",
          percentualAplicado: 5,
          valorBase: 1000,
          valorComissao: 50,
          status: "PENDENTE",
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const contaPendenteDepois = await prisma.contaReceber.findUniqueOrThrow({ where: { id: contaPendente.id } });
      expect(contaPendenteDepois.status).toBe("CANCELADO");

      const contaParcialDepois = await prisma.contaReceber.findUniqueOrThrow({ where: { id: contaParcial.id } });
      expect(contaParcialDepois.status).toBe("PARCIAL"); // não mexido — dinheiro real já entrou

      const comissaoDepois = await prisma.comissao.findUniqueOrThrow({ where: { id: comissao.id } });
      expect(comissaoDepois.status).toBe("CANCELADA");

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs.some((l) => l.acao === "conta_receber.cancelar" && l.entidadeId === contaPendente.id)).toBe(true);
      expect(logs.some((l) => l.acao === "comissao.cancelar" && l.entidadeId === comissao.id)).toBe(true);
      // A conta parcial não gera log de cancelamento nenhum.
      expect(logs.some((l) => l.entidadeId === contaParcial.id)).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "não mexe em Comissao já PAGA nem gera log pra ela",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const comissaoPaga = await prisma.comissao.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          usuarioId: f.usuarioId,
          baseCalculo: "VALOR",
          percentualAplicado: 5,
          valorBase: 1000,
          valorComissao: 50,
          status: "PAGA",
          pagoEm: new Date(),
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const comissaoDepois = await prisma.comissao.findUniqueOrThrow({ where: { id: comissaoPaga.id } });
      expect(comissaoDepois.status).toBe("PAGA"); // dinheiro já pago, não estorna sozinho

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs.some((l) => l.acao === "comissao.cancelar")).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "orçamento de pedido cancelado sai do faturamento de buscarVisaoGeralNegocio",
    async () => {
      const f = await criarFixture({ comValorFaturamento: 12345 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const antes = await buscarVisaoGeralNegocio(f.graficaId);
      expect(antes.faturamentoMes.total).toBeGreaterThanOrEqual(12345);

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const depois = await buscarVisaoGeralNegocio(f.graficaId);
      expect(depois.faturamentoMes.total).toBe(antes.faturamentoMes.total - 12345);
    },
    TIMEOUT_MS
  );
});
