import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { saldoContaReceber } from "@/lib/baixa-financeira";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.credito-cliente.test.ts) — cobre o achado A8 da
// Parte 4 da auditoria de abrangência (2026-08-29): registrarBaixaContaReceber
// (renomeada de marcarComoRecebido) passa a aceitar um valor MENOR que o
// saldo em aberto (recebimento parcial), rejeita um valor MAIOR (nunca
// aplica "com sobra" em silêncio) e continua fechando a conta pelo caminho
// ANTIGO quando o valor bate exato com o total, sem nenhuma linha em
// BaixaContaReceber. FALHA ESPERADA até a migration
// 20260829110000_baixa_parcial_financeiro ser aplicada ao banco.
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
    data: { nome: `Teste Baixa Explicita ${s}`, slug: `teste-baixa-explicita-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-baixa-explicita-${s}@example.com`,
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

async function logarComo(usuarioId: string) {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })) as never
  );
}

describe("registrarBaixaContaReceber — recebimento parcial (achado A8 da Parte 4)", () => {
  it(
    "valor EXATO com o total (sem mexer no campo, comportamento de sempre): fecha a conta pelo caminho ANTIGO, sem nenhuma BaixaContaReceber",
    async () => {
      const f = await criarFixture({ total: 5000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX", valor: "5000" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toBe("Conta marcada como recebida.");
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("RECEBIDO");
      expect(conta.pagamentoId).not.toBeNull();
      const baixas = await prisma.baixaContaReceber.findMany({ where: { contaReceberId: f.contaId } });
      expect(baixas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "valor MENOR que o saldo: marca PARCIAL, saldo calculado corretamente",
    async () => {
      const f = await criarFixture({ total: 5000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX", valor: "3000" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toBe("Baixa parcial registrada.");
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("PARCIAL");
      expect(conta.pagamentoId).toBeNull();
      const saldo = await saldoContaReceber(prisma, conta);
      expect(saldo.toFixed(2)).toBe("2000.00");
    },
    TIMEOUT_MS
  );

  it(
    "segunda baixa que completa o saldo remanescente: fecha a conta (RECEBIDO)",
    async () => {
      const f = await criarFixture({ total: 5000 });
      await logarComo(f.usuarioId);

      await registrarBaixaContaReceber(null, formDataDe({ id: f.contaId, forma: "PIX", valor: "3000" }));
      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "BOLETO", valor: "2000" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toBe("Conta marcada como recebida.");
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("RECEBIDO");
      expect(conta.recebidoEm).not.toBeNull();
      const saldo = await saldoContaReceber(prisma, conta);
      expect(saldo.toFixed(2)).toBe("0.00");
    },
    TIMEOUT_MS
  );

  it(
    "múltiplas baixas parciais (3x) somam corretamente até fechar a conta — soma sem dedup incorreto",
    async () => {
      const f = await criarFixture({ total: 900 });
      await logarComo(f.usuarioId);

      await registrarBaixaContaReceber(null, formDataDe({ id: f.contaId, forma: "PIX", valor: "300" }));
      await registrarBaixaContaReceber(null, formDataDe({ id: f.contaId, forma: "PIX", valor: "300" }));
      const resultadoFinal = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX", valor: "300" })
      );

      expect(resultadoFinal.ok).toBe(true);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("RECEBIDO");
      const baixas = await prisma.baixaContaReceber.findMany({ where: { contaReceberId: f.contaId } });
      expect(baixas).toHaveLength(3);
      const somaBaixas = baixas.reduce((soma, b) => soma + Number(b.valor), 0);
      expect(somaBaixas).toBe(900);
    },
    TIMEOUT_MS
  );

  it(
    "valor MAIOR que o saldo em aberto: rejeitado com mensagem clara, nada é alterado",
    async () => {
      const f = await criarFixture({ total: 5000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX", valor: "5000.01" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("maior que o saldo em aberto");
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("PENDENTE");
      expect(conta.pagamentoId).toBeNull();
      const pagamentos = await prisma.pagamento.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamentos).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "valor MAIOR que o saldo remanescente de uma conta já PARCIAL: também rejeitado (nunca aplica parcial+sobra)",
    async () => {
      const f = await criarFixture({ total: 5000 });
      await logarComo(f.usuarioId);

      await registrarBaixaContaReceber(null, formDataDe({ id: f.contaId, forma: "PIX", valor: "3000" }));
      // Saldo remanescente é 2000 — pedir 2500 deve ser rejeitado.
      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX", valor: "2500" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("maior que o saldo em aberto");
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("PARCIAL");
      const saldo = await saldoContaReceber(prisma, conta);
      expect(saldo.toFixed(2)).toBe("2000.00"); // não mudou
    },
    TIMEOUT_MS
  );
});
