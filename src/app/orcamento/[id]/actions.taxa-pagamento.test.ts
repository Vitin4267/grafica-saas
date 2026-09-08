import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.conta-financeira.test.ts) — cobre o lado Pagamento
// do achado A11 da Parte 4 da auditoria de abrangência (2026-09-08):
// Pagamento.valorTaxa é aditivo (@default(0)), NUNCA calculado
// automaticamente sobre um pagamento já existente — só o que o usuário
// preenche ao registrar um pagamento NOVO. FALHA ESPERADA até a migration
// 20260908140000_taxa_forma_pagamento ser aplicada ao banco (mesmo padrão já
// documentado em actions.conta-financeira.test.ts).
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
    data: { nome: `Teste Pagamento Taxa ${s}`, slug: `teste-pagamento-taxa-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-pagamento-taxa-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: opts.total },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, orcamentoId: orcamento.id };
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
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("registrarPagamento — Pagamento.valorTaxa (achado A11 da Parte 4)", () => {
  it(
    "sem valorTaxa (campo não enviado): fica 0 — regressão zero do comportamento de hoje",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarPagamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, valor: "1000", forma: "PIX" })
      );

      expect(resultado.ok).toBe(true);
      const pagamento = await prisma.pagamento.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(Number(pagamento.valorTaxa)).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "com valorTaxa preenchido: grava o valor exato informado, sem recalcular nada",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarPagamento(
        null,
        formDataDe({
          orcamentoId: f.orcamentoId,
          valor: "1000",
          forma: "CARTAO_CREDITO",
          valorTaxa: "35.00",
        })
      );

      expect(resultado.ok).toBe(true);
      const pagamento = await prisma.pagamento.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(Number(pagamento.valorTaxa)).toBe(35);
      expect(pagamento.forma).toBe("CARTAO_CREDITO");
    },
    TIMEOUT_MS
  );

  it(
    "valorTaxa negativo é rejeitado, nenhum Pagamento é criado",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarPagamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, valor: "1000", forma: "PIX", valorTaxa: "-5" })
      );

      expect(resultado.ok).toBe(false);
      const pagamentos = await prisma.pagamento.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamentos).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "aceita CARTAO_DEBITO e CHEQUE (novos valores de FormaPagamento, aditivos ao enum)",
    async () => {
      const f = await criarFixture({ total: 500 });
      await logarComo(f.usuarioId);

      const debito = await registrarPagamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, valor: "200", forma: "CARTAO_DEBITO" })
      );
      expect(debito.ok).toBe(true);

      const cheque = await registrarPagamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, valor: "300", forma: "CHEQUE" })
      );
      expect(cheque.ok).toBe(true);

      const pagamentos = await prisma.pagamento.findMany({
        where: { orcamentoId: f.orcamentoId },
        orderBy: { valor: "asc" },
      });
      expect(pagamentos.map((p) => p.forma)).toEqual(["CARTAO_DEBITO", "CHEQUE"]);
    },
    TIMEOUT_MS
  );
});
