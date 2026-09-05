import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/financeiro/actions.baixa-parcial.test.ts) — cobre
// o CRUD de ContaFinanceira, achado A15 da Parte 4 da auditoria de
// abrangência (2026-09-04). FALHA ESPERADA até a migration
// 20260904130000_conta_financeira ser aplicada ao banco (mesmo padrão já
// documentado em src/app/financeiro/actions.baixa-parcial.test.ts).
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
  criarContaFinanceira,
  editarContaFinanceira,
  alternarAtivaContaFinanceira,
} from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Conta Financeira ${s}`, slug: `teste-conta-financeira-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-conta-financeira-${s}@example.com`,
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
    await prisma.contaFinanceira.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("ContaFinanceira — CRUD (achado A15 da Parte 4)", () => {
  it(
    "criarContaFinanceira: cria com tipo/saldo inicial e redireciona pra tela de detalhe",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await expect(
        criarContaFinanceira(
          null,
          formDataDe({
            nome: "Banco do Brasil",
            tipo: "CONTA_CORRENTE",
            saldoInicial: "1500.50",
            saldoInicialEm: "2026-09-01",
          })
        )
      ).rejects.toThrow("NEXT_REDIRECT");

      const conta = await prisma.contaFinanceira.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: "Banco do Brasil" },
      });
      expect(conta.tipo).toBe("CONTA_CORRENTE");
      expect(Number(conta.saldoInicial)).toBe(1500.5);
      expect(conta.saldoInicialEm).not.toBeNull();
      expect(conta.ativa).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "criarContaFinanceira: sem saldo inicial informado, default é 0 e saldoInicialEm fica null",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      await expect(
        criarContaFinanceira(null, formDataDe({ nome: "Caixa da loja", tipo: "CAIXA" }))
      ).rejects.toThrow("NEXT_REDIRECT");

      const conta = await prisma.contaFinanceira.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: "Caixa da loja" },
      });
      expect(conta.tipo).toBe("CAIXA");
      expect(Number(conta.saldoInicial)).toBe(0);
      expect(conta.saldoInicialEm).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "criarContaFinanceira: nome duplicado na mesma gráfica é rejeitado",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      await prisma.contaFinanceira.create({
        data: { graficaId: f.graficaId, nome: "Conta Principal", tipo: "CONTA_CORRENTE" },
      });

      const resultado = await criarContaFinanceira(
        null,
        formDataDe({ nome: "Conta Principal", tipo: "POUPANCA" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Já existe uma conta financeira");
    },
    TIMEOUT_MS
  );

  it(
    "criarContaFinanceira: nome vazio ou tipo inválido são rejeitados",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const semNome = await criarContaFinanceira(
        null,
        formDataDe({ nome: "  ", tipo: "CONTA_CORRENTE" })
      );
      expect(semNome.ok).toBe(false);

      const tipoInvalido = await criarContaFinanceira(
        null,
        formDataDe({ nome: "Conta X", tipo: "NAO_EXISTE" })
      );
      expect(tipoInvalido.ok).toBe(false);
      expect(tipoInvalido.mensagem).toContain("Tipo de conta inválido");
    },
    TIMEOUT_MS
  );

  it(
    "editarContaFinanceira: atualiza nome/tipo/saldo de uma conta já existente",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const conta = await prisma.contaFinanceira.create({
        data: { graficaId: f.graficaId, nome: "Conta Antiga", tipo: "CONTA_CORRENTE", saldoInicial: 100 },
      });

      const resultado = await editarContaFinanceira(
        null,
        formDataDe({
          contaId: conta.id,
          nome: "Conta Renomeada",
          tipo: "CARTEIRA_DIGITAL",
          saldoInicial: "250",
        })
      );

      expect(resultado.ok).toBe(true);
      const atualizada = await prisma.contaFinanceira.findUniqueOrThrow({ where: { id: conta.id } });
      expect(atualizada.nome).toBe("Conta Renomeada");
      expect(atualizada.tipo).toBe("CARTEIRA_DIGITAL");
      expect(Number(atualizada.saldoInicial)).toBe(250);
    },
    TIMEOUT_MS
  );

  it(
    "editarContaFinanceira: conta de outra gráfica não é encontrada (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      const outra = await criarFixture();
      await logarComo(f.usuarioId);
      const contaDeOutraGrafica = await prisma.contaFinanceira.create({
        data: { graficaId: outra.graficaId, nome: "Conta Alheia", tipo: "CONTA_CORRENTE" },
      });

      const resultado = await editarContaFinanceira(
        null,
        formDataDe({ contaId: contaDeOutraGrafica.id, nome: "Tentativa", tipo: "CAIXA" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("não encontrada");
    },
    TIMEOUT_MS
  );

  it(
    "alternarAtivaContaFinanceira: alterna ativa/inativa sem apagar a conta",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const conta = await prisma.contaFinanceira.create({
        data: { graficaId: f.graficaId, nome: "Conta Alternável", tipo: "CAIXA" },
      });
      expect(conta.ativa).toBe(true);

      const desativou = await alternarAtivaContaFinanceira(null, formDataDe({ contaId: conta.id }));
      expect(desativou.ok).toBe(true);
      let atual = await prisma.contaFinanceira.findUniqueOrThrow({ where: { id: conta.id } });
      expect(atual.ativa).toBe(false);

      const reativou = await alternarAtivaContaFinanceira(null, formDataDe({ contaId: conta.id }));
      expect(reativou.ok).toBe(true);
      atual = await prisma.contaFinanceira.findUniqueOrThrow({ where: { id: conta.id } });
      expect(atual.ativa).toBe(true);
    },
    TIMEOUT_MS
  );
});
