import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.baixa-parcial.test.ts) — cobre o lado
// registrarBaixaContaReceber do achado A11 da Parte 4 da auditoria de
// abrangência (2026-09-08): o Pagamento gerado ao registrar uma baixa também
// aceita valorTaxa (opcional, aditivo, @default(0)). FALHA ESPERADA até a
// migration 20260908140000_taxa_forma_pagamento ser aplicada ao banco.
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
import { registrarBaixaContaReceber } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(opts: { total: number }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Baixa Taxa ${s}`, slug: `teste-baixa-taxa-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-baixa-taxa-${s}@example.com`,
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
      vencimento: new Date("2026-09-01T00:00:00Z"),
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

describe("registrarBaixaContaReceber — Pagamento.valorTaxa (achado A11 da Parte 4)", () => {
  it(
    "sem valorTaxa (campo não enviado): Pagamento gerado fica com valorTaxa 0 — regressão zero",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX" })
      );

      expect(resultado.ok).toBe(true);
      const pagamento = await prisma.pagamento.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(Number(pagamento.valorTaxa)).toBe(0);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("RECEBIDO");
    },
    TIMEOUT_MS
  );

  it(
    "com valorTaxa preenchido: grava o valor exato no Pagamento gerado",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "CARTAO_CREDITO", valorTaxa: "35.00" })
      );

      expect(resultado.ok).toBe(true);
      const pagamento = await prisma.pagamento.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(Number(pagamento.valorTaxa)).toBe(35);
      expect(pagamento.forma).toBe("CARTAO_CREDITO");
    },
    TIMEOUT_MS
  );

  it(
    "valorTaxa negativo é rejeitado, nenhum Pagamento é criado e a conta continua PENDENTE",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX", valorTaxa: "-1" })
      );

      expect(resultado.ok).toBe(false);
      const pagamentos = await prisma.pagamento.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamentos).toHaveLength(0);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("PENDENTE");
    },
    TIMEOUT_MS
  );
});
