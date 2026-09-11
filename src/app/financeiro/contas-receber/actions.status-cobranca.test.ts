import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.baixa-parcial.test.ts) — cobre o achado A5 da
// Parte 4 da auditoria de abrangência (2026-09-09, "régua de cobrança +
// juros/multa", fatia 1: status honesto). marcarContaReceberEmCobranca/
// marcarContaReceberPerda são as duas ações novas, e
// registrarBaixaContaReceber passa a aceitar baixa também a partir de
// EM_COBRANCA. FALHA ESPERADA até a migration
// 20260909150000_regua_cobranca_status_juros ser aplicada ao banco (os
// valores de enum EM_COBRANCA/PERDA ainda não existem no Postgres de dev).
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
import {
  marcarContaReceberEmCobranca,
  marcarContaReceberPerda,
  registrarBaixaContaReceber,
} from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(opts: { total: number }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Status Cobranca ${s}`, slug: `teste-status-cobranca-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-status-cobranca-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: opts.total },
  });
  const conta = await prisma.contaReceber.create({
    data: {
      graficaId: grafica.id,
      orcamentoId: orcamento.id,
      descricao: "Parcela única",
      valor: opts.total,
      vencimento: new Date("2026-01-01T00:00:00Z"),
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, orcamentoId: orcamento.id, contaId: conta.id };
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
    await prisma.baixaContaReceber.deleteMany({ where: { contaReceber: { graficaId } } });
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.pagamento.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("marcarContaReceberEmCobranca (achado A5 da Parte 4)", () => {
  it(
    "PENDENTE -> EM_COBRANCA: transição manual funciona",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await marcarContaReceberEmCobranca(null, formDataDe({ id: f.contaId }));

      expect(resultado.ok).toBe(true);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("EM_COBRANCA");
    },
    TIMEOUT_MS
  );

  it(
    "conta já RECEBIDO não pode ser marcada em cobrança (CAS rejeita)",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);
      await prisma.contaReceber.update({
        where: { id: f.contaId },
        data: { status: "RECEBIDO", recebidoEm: new Date() },
      });

      const resultado = await marcarContaReceberEmCobranca(null, formDataDe({ id: f.contaId }));

      expect(resultado.ok).toBe(false);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("RECEBIDO");
    },
    TIMEOUT_MS
  );

  it(
    "conta EM_COBRANCA ainda aceita baixa normalmente (dívida em cobrança pode ser recebida)",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);
      await marcarContaReceberEmCobranca(null, formDataDe({ id: f.contaId }));

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX" })
      );

      expect(resultado.ok).toBe(true);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("RECEBIDO");
    },
    TIMEOUT_MS
  );
});

describe("marcarContaReceberPerda (achado A5 da Parte 4)", () => {
  it(
    "PENDENTE -> PERDA: transição manual funciona, distinta de CANCELADO",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await marcarContaReceberPerda(null, formDataDe({ id: f.contaId }));

      expect(resultado.ok).toBe(true);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("PERDA");
    },
    TIMEOUT_MS
  );

  it(
    "EM_COBRANCA -> PERDA: uma conta em cobrança também pode ser dada como perdida",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);
      await marcarContaReceberEmCobranca(null, formDataDe({ id: f.contaId }));

      const resultado = await marcarContaReceberPerda(null, formDataDe({ id: f.contaId }));

      expect(resultado.ok).toBe(true);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("PERDA");
    },
    TIMEOUT_MS
  );

  it(
    "conta já em PERDA não aceita baixa (mesma trava de RECEBIDO/CANCELADO)",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);
      await marcarContaReceberPerda(null, formDataDe({ id: f.contaId }));

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX" })
      );

      expect(resultado.ok).toBe(false);
      const pagamentos = await prisma.pagamento.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamentos).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "conta CANCELADO não pode ser marcada como perda (CAS rejeita)",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);
      await prisma.contaReceber.update({ where: { id: f.contaId }, data: { status: "CANCELADO" } });

      const resultado = await marcarContaReceberPerda(null, formDataDe({ id: f.contaId }));

      expect(resultado.ok).toBe(false);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("CANCELADO");
    },
    TIMEOUT_MS
  );
});
