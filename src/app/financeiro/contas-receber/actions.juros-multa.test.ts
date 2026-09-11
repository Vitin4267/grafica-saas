import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.taxa-pagamento.test.ts) — cobre o lado
// registrarBaixaContaReceber do achado A5 da Parte 4 da auditoria de
// abrangência (2026-09-09, "régua de cobrança + juros/multa", fatia 2): o
// Pagamento gerado ao registrar uma baixa também aceita valorJuros/
// valorMulta (opcionais, aditivos, @default(0)). FALHA ESPERADA até a
// migration 20260909150000_regua_cobranca_status_juros ser aplicada ao
// banco.
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
    data: { nome: `Teste Baixa Juros ${s}`, slug: `teste-baixa-juros-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-baixa-juros-${s}@example.com`,
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

describe("registrarBaixaContaReceber — Pagamento.valorJuros/valorMulta (achado A5 da Parte 4)", () => {
  it(
    "sem valorJuros/valorMulta (campos não enviados): Pagamento gerado fica com os dois em 0 — regressão zero",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX" })
      );

      expect(resultado.ok).toBe(true);
      const pagamento = await prisma.pagamento.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(Number(pagamento.valorJuros)).toBe(0);
      expect(Number(pagamento.valorMulta)).toBe(0);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("RECEBIDO");
    },
    TIMEOUT_MS
  );

  it(
    "com valorJuros/valorMulta preenchidos: grava os valores exatos no Pagamento gerado, sem afetar o saldo da conta",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX", valorJuros: "15.50", valorMulta: "20.00" })
      );

      expect(resultado.ok).toBe(true);
      const pagamento = await prisma.pagamento.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(Number(pagamento.valorJuros)).toBe(15.5);
      expect(Number(pagamento.valorMulta)).toBe(20);
      // Juros/multa não entram no valor que baixa a conta — o Pagamento.valor
      // continua sendo só o que quita a ContaReceber (mesmo raciocínio de
      // valorTaxa, achado A11).
      expect(Number(pagamento.valor)).toBe(1000);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("RECEBIDO");
    },
    TIMEOUT_MS
  );

  it(
    "valorJuros negativo é rejeitado, nenhum Pagamento é criado e a conta continua PENDENTE",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX", valorJuros: "-5" })
      );

      expect(resultado.ok).toBe(false);
      const pagamentos = await prisma.pagamento.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamentos).toHaveLength(0);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("PENDENTE");
    },
    TIMEOUT_MS
  );

  it(
    "valorMulta negativo é rejeitado, nenhum Pagamento é criado e a conta continua PENDENTE",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(
        null,
        formDataDe({ id: f.contaId, forma: "PIX", valorMulta: "-5" })
      );

      expect(resultado.ok).toBe(false);
      const pagamentos = await prisma.pagamento.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamentos).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
