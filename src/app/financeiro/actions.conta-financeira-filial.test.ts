import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.baixa-parcial.test.ts) — cobre o achado A15 da
// Parte 4 da auditoria de abrangência (2026-09-04): vínculo OPCIONAL de
// Despesa a ContaFinanceira (preenchido na baixa, ver marcarComoPaga) e a
// Filial (preenchido na criação/edição, mesmo padrão de Orcamento.filialId).
// FALHA ESPERADA até a migration 20260904130000_conta_financeira ser
// aplicada ao banco (mesmo padrão já documentado em
// actions.baixa-parcial.test.ts).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
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
import { criarDespesa, editarDespesa, marcarComoPaga, marcarComoPendente } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Conta/Filial Despesa ${s}`, slug: `teste-conta-filial-despesa-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-conta-filial-despesa-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const filial = await prisma.filial.create({
    data: { graficaId: grafica.id, nome: `Filial ${s}` },
  });
  const contaFinanceira = await prisma.contaFinanceira.create({
    data: { graficaId: grafica.id, nome: `Conta ${s}`, tipo: "CONTA_CORRENTE" },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, filialId: filial.id, contaFinanceiraId: contaFinanceira.id };
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
    await prisma.pagamentoDespesa.deleteMany({ where: { despesa: { graficaId } } });
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.contaFinanceira.deleteMany({ where: { graficaId } });
    await prisma.filial.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("Despesa.filialId — opcional (achado A15 da Parte 4)", () => {
  it(
    "criarDespesa: com filialId, grava o vínculo",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({
          descricao: "Aluguel da filial",
          valor: "500",
          vencimento: "2026-10-01",
          filialId: f.filialId,
        })
      );

      expect(resultado.ok).toBe(true);
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Aluguel da filial" },
      });
      expect(despesa.filialId).toBe(f.filialId);
    },
    TIMEOUT_MS
  );

  it(
    "criarDespesa: sem filialId (campo nem enviado), fica null — comportamento de hoje preservado",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({ descricao: "Despesa sem filial", valor: "200", vencimento: "2026-10-01" })
      );

      expect(resultado.ok).toBe(true);
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Despesa sem filial" },
      });
      expect(despesa.filialId).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "criarDespesa: filialId de outra gráfica é rejeitado (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      const outra = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({
          descricao: "Despesa filial alheia",
          valor: "200",
          vencimento: "2026-10-01",
          filialId: outra.filialId,
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Filial não encontrada");
    },
    TIMEOUT_MS
  );

  it(
    "editarDespesa: troca a filial vinculada, e consegue voltar a 'sem filial específica'",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const despesa = await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa editável",
          valor: 300,
          vencimento: new Date("2026-10-01T00:00:00Z"),
          filialId: f.filialId,
        },
      });

      const semFilial = await editarDespesa(
        null,
        formDataDe({
          despesaId: despesa.id,
          descricao: "Despesa editável",
          valor: "300",
          vencimento: "2026-10-01",
        })
      );
      expect(semFilial.ok).toBe(true);
      const atualizada = await prisma.despesa.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(atualizada.filialId).toBeNull();
    },
    TIMEOUT_MS
  );
});

describe("Despesa.contaFinanceiraId — opcional, preenchido na baixa (achado A15 da Parte 4)", () => {
  it(
    "marcarComoPaga: com contaFinanceiraId, grava o vínculo na Despesa",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const despesa = await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa com conta",
          valor: 1000,
          vencimento: new Date("2026-09-01T00:00:00Z"),
        },
      });

      const resultado = await marcarComoPaga(
        null,
        formDataDe({
          despesaId: despesa.id,
          formaPagamento: "PIX",
          valor: "1000",
          contaFinanceiraId: f.contaFinanceiraId,
        })
      );

      expect(resultado.ok).toBe(true);
      const atualizada = await prisma.despesa.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(atualizada.status).toBe("PAGA");
      expect(atualizada.contaFinanceiraId).toBe(f.contaFinanceiraId);
    },
    TIMEOUT_MS
  );

  it(
    "marcarComoPaga: sem contaFinanceiraId (campo não enviado), fica null — comportamento de hoje preservado",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const despesa = await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa sem conta",
          valor: 1000,
          vencimento: new Date("2026-09-01T00:00:00Z"),
        },
      });

      const resultado = await marcarComoPaga(
        null,
        formDataDe({ despesaId: despesa.id, formaPagamento: "PIX", valor: "1000" })
      );

      expect(resultado.ok).toBe(true);
      const atualizada = await prisma.despesa.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(atualizada.status).toBe("PAGA");
      expect(atualizada.contaFinanceiraId).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "marcarComoPaga: contaFinanceiraId de outra gráfica é rejeitado (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      const outra = await criarFixture();
      await logarComo(f.usuarioId);
      const despesa = await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa conta alheia",
          valor: 1000,
          vencimento: new Date("2026-09-01T00:00:00Z"),
        },
      });

      const resultado = await marcarComoPaga(
        null,
        formDataDe({
          despesaId: despesa.id,
          formaPagamento: "PIX",
          valor: "1000",
          contaFinanceiraId: outra.contaFinanceiraId,
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Conta financeira não encontrada");
      const inalterada = await prisma.despesa.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(inalterada.status).toBe("PENDENTE");
    },
    TIMEOUT_MS
  );

  it(
    "marcarComoPendente: desfaz e limpa o vínculo de conta financeira também",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const despesa = await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa a desfazer",
          valor: 1000,
          vencimento: new Date("2026-09-01T00:00:00Z"),
        },
      });
      await marcarComoPaga(
        null,
        formDataDe({
          despesaId: despesa.id,
          formaPagamento: "PIX",
          valor: "1000",
          contaFinanceiraId: f.contaFinanceiraId,
        })
      );

      const resultado = await marcarComoPendente(null, formDataDe({ despesaId: despesa.id }));

      expect(resultado.ok).toBe(true);
      const atualizada = await prisma.despesa.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(atualizada.status).toBe("PENDENTE");
      expect(atualizada.contaFinanceiraId).toBeNull();
    },
    TIMEOUT_MS
  );
});
