import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.baixa-parcial.test.ts) — cobre o lado Pagamento do
// achado A15 da Parte 4 da auditoria de abrangência (2026-09-04): vínculo
// OPCIONAL de Pagamento a ContaFinanceira, preenchido no momento do
// registro. FALHA ESPERADA até a migration 20260904130000_conta_financeira
// ser aplicada ao banco (mesmo padrão já documentado em
// actions.baixa-parcial.test.ts).
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
import { registrarPagamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(opts: { total: number }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Pagamento Conta ${s}`, slug: `teste-pagamento-conta-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-pagamento-conta-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: opts.total },
  });
  const contaFinanceira = await prisma.contaFinanceira.create({
    data: { graficaId: grafica.id, nome: `Conta ${s}`, tipo: "CONTA_CORRENTE" },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, orcamentoId: orcamento.id, contaFinanceiraId: contaFinanceira.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function logarComo(usuarioId: string) {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })) as never
  );
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.pagamento.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.contaFinanceira.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("registrarPagamento — vínculo opcional com ContaFinanceira (achado A15 da Parte 4)", () => {
  it(
    "com contaFinanceiraId: grava o vínculo no Pagamento criado",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarPagamento(
        null,
        formDataDe({
          orcamentoId: f.orcamentoId,
          valor: "1000",
          forma: "PIX",
          contaFinanceiraId: f.contaFinanceiraId,
        })
      );

      expect(resultado.ok).toBe(true);
      const pagamento = await prisma.pagamento.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamento.contaFinanceiraId).toBe(f.contaFinanceiraId);
    },
    TIMEOUT_MS
  );

  it(
    "sem contaFinanceiraId (campo não enviado): fica null — comportamento de hoje preservado",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarPagamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, valor: "1000", forma: "PIX" })
      );

      expect(resultado.ok).toBe(true);
      const pagamento = await prisma.pagamento.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamento.contaFinanceiraId).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "contaFinanceiraId de outra gráfica é rejeitado (isolamento de tenant), nenhum Pagamento é criado",
    async () => {
      const f = await criarFixture({ total: 1000 });
      const outra = await criarFixture({ total: 500 });
      await logarComo(f.usuarioId);

      const resultado = await registrarPagamento(
        null,
        formDataDe({
          orcamentoId: f.orcamentoId,
          valor: "1000",
          forma: "PIX",
          contaFinanceiraId: outra.contaFinanceiraId,
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Conta financeira não encontrada");
      const pagamentos = await prisma.pagamento.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamentos).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
