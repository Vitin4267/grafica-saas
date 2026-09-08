import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de configuracoes/contas-financeiras/actions.test.ts) — cobre
// o CRUD de TaxaFormaPagamento, achado A11 da Parte 4 da auditoria de
// abrangência (2026-09-08). FALHA ESPERADA até a migration
// 20260908140000_taxa_forma_pagamento ser aplicada ao banco (mesmo padrão já
// documentado em configuracoes/contas-financeiras/actions.test.ts).
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
import {
  criarTaxaFormaPagamento,
  editarTaxaFormaPagamento,
  alternarAtivaTaxaFormaPagamento,
} from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Taxa Forma Pagamento ${s}`, slug: `teste-taxa-forma-pagamento-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-taxa-forma-pagamento-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id };
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
    await prisma.taxaFormaPagamento.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("TaxaFormaPagamento — CRUD (achado A11 da Parte 4)", () => {
  it(
    "criarTaxaFormaPagamento: cria com percentual/dias de compensação e redireciona pra tela de detalhe",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await expect(
        criarTaxaFormaPagamento(
          null,
          formDataDe({ forma: "CARTAO_CREDITO", percentual: "3.5", diasCompensacao: "30" })
        )
      ).rejects.toThrow("NEXT_REDIRECT");

      const taxa = await prisma.taxaFormaPagamento.findFirstOrThrow({
        where: { graficaId: f.graficaId, forma: "CARTAO_CREDITO" },
      });
      expect(Number(taxa.percentual)).toBe(3.5);
      expect(taxa.diasCompensacao).toBe(30);
      expect(taxa.ativa).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "criarTaxaFormaPagamento: sem percentual/dias informados, default é 0",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await expect(
        criarTaxaFormaPagamento(null, formDataDe({ forma: "PIX" }))
      ).rejects.toThrow("NEXT_REDIRECT");

      const taxa = await prisma.taxaFormaPagamento.findFirstOrThrow({
        where: { graficaId: f.graficaId, forma: "PIX" },
      });
      expect(Number(taxa.percentual)).toBe(0);
      expect(taxa.diasCompensacao).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "criarTaxaFormaPagamento: forma duplicada na mesma gráfica é rejeitada",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      await prisma.taxaFormaPagamento.create({
        data: { graficaId: f.graficaId, forma: "PIX", percentual: 0, diasCompensacao: 0 },
      });

      const resultado = await criarTaxaFormaPagamento(
        null,
        formDataDe({ forma: "PIX", percentual: "1", diasCompensacao: "1" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Já existe uma taxa cadastrada");
    },
    TIMEOUT_MS
  );

  it(
    "criarTaxaFormaPagamento: forma inválida é rejeitada",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarTaxaFormaPagamento(
        null,
        formDataDe({ forma: "NAO_EXISTE", percentual: "1", diasCompensacao: "1" })
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Forma de pagamento inválida");
    },
    TIMEOUT_MS
  );

  it(
    "editarTaxaFormaPagamento: atualiza percentual/dias de um cadastro já existente",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const taxa = await prisma.taxaFormaPagamento.create({
        data: { graficaId: f.graficaId, forma: "CHEQUE", percentual: 0, diasCompensacao: 0 },
      });

      const resultado = await editarTaxaFormaPagamento(
        null,
        formDataDe({ taxaId: taxa.id, percentual: "2.25", diasCompensacao: "15" })
      );

      expect(resultado.ok).toBe(true);
      const atualizada = await prisma.taxaFormaPagamento.findUniqueOrThrow({ where: { id: taxa.id } });
      expect(Number(atualizada.percentual)).toBe(2.25);
      expect(atualizada.diasCompensacao).toBe(15);
    },
    TIMEOUT_MS
  );

  it(
    "editarTaxaFormaPagamento: taxa de outra gráfica não é encontrada (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      const outra = await criarFixture();
      await logarComo(f.usuarioId);
      const taxaDeOutraGrafica = await prisma.taxaFormaPagamento.create({
        data: { graficaId: outra.graficaId, forma: "PIX", percentual: 0, diasCompensacao: 0 },
      });

      const resultado = await editarTaxaFormaPagamento(
        null,
        formDataDe({ taxaId: taxaDeOutraGrafica.id, percentual: "5", diasCompensacao: "5" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("não encontrada");
    },
    TIMEOUT_MS
  );

  it(
    "alternarAtivaTaxaFormaPagamento: alterna ativa/inativa sem apagar a taxa",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const taxa = await prisma.taxaFormaPagamento.create({
        data: { graficaId: f.graficaId, forma: "BOLETO", percentual: 0, diasCompensacao: 2 },
      });
      expect(taxa.ativa).toBe(true);

      const desativou = await alternarAtivaTaxaFormaPagamento(null, formDataDe({ taxaId: taxa.id }));
      expect(desativou.ok).toBe(true);
      let atual = await prisma.taxaFormaPagamento.findUniqueOrThrow({ where: { id: taxa.id } });
      expect(atual.ativa).toBe(false);

      const reativou = await alternarAtivaTaxaFormaPagamento(null, formDataDe({ taxaId: taxa.id }));
      expect(reativou.ok).toBe(true);
      atual = await prisma.taxaFormaPagamento.findUniqueOrThrow({ where: { id: taxa.id } });
      expect(atual.ativa).toBe(true);
    },
    TIMEOUT_MS
  );
});
