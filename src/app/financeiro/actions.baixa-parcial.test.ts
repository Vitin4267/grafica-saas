import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { saldoDespesa } from "@/lib/baixa-financeira";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.credito-cliente.test.ts) — cobre o lado Despesa do
// achado A8 da Parte 4 da auditoria de abrangência (2026-08-29): marcarComoPaga
// passa a aceitar um valor MENOR que o saldo em aberto (pagamento parcial,
// StatusDespesa.PARCIAL) e rejeita um valor MAIOR; marcarComoPendente desfaz
// tudo (inclusive as linhas de PagamentoDespesa acumuladas). FALHA ESPERADA
// até a migration 20260829110000_baixa_parcial_financeiro ser aplicada ao
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
import { marcarComoPaga, marcarComoPendente } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(opts: { valor: number }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Baixa Despesa ${s}`, slug: `teste-baixa-despesa-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-baixa-despesa-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const despesa = await prisma.despesa.create({
    data: {
      graficaId: grafica.id,
      descricao: `Despesa Teste ${s}`,
      valor: opts.valor,
      vencimento: new Date("2026-09-01T00:00:00Z"),
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, despesaId: despesa.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.pagamentoDespesa.deleteMany({ where: { despesa: { graficaId } } });
    await prisma.despesa.deleteMany({ where: { graficaId } });
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

describe("marcarComoPaga / marcarComoPendente — pagamento parcial de Despesa (achado A8 da Parte 4)", () => {
  it(
    "valor EXATO com o total (sem mexer no campo, comportamento de sempre): fecha PAGA, com pagoEm/formaPagamento setados — regressão zero",
    async () => {
      const f = await criarFixture({ valor: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await marcarComoPaga(
        null,
        formDataDe({ despesaId: f.despesaId, formaPagamento: "PIX", valor: "1000" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toBe("Despesa marcada como paga.");
      const despesa = await prisma.despesa.findUniqueOrThrow({ where: { id: f.despesaId } });
      expect(despesa.status).toBe("PAGA");
      expect(despesa.pagoEm).not.toBeNull();
      expect(despesa.formaPagamento).toBe("PIX");
      const pagamentos = await prisma.pagamentoDespesa.findMany({ where: { despesaId: f.despesaId } });
      expect(pagamentos).toHaveLength(1);
      expect(Number(pagamentos[0].valor)).toBe(1000);
    },
    TIMEOUT_MS
  );

  it(
    "valor MENOR que o saldo: marca PARCIAL, saldo calculado corretamente, pagoEm continua null",
    async () => {
      const f = await criarFixture({ valor: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await marcarComoPaga(
        null,
        formDataDe({ despesaId: f.despesaId, formaPagamento: "PIX", valor: "400" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toBe("Baixa parcial registrada.");
      const despesa = await prisma.despesa.findUniqueOrThrow({ where: { id: f.despesaId } });
      expect(despesa.status).toBe("PARCIAL");
      expect(despesa.pagoEm).toBeNull();
      const saldo = await saldoDespesa(prisma, despesa);
      expect(saldo.toFixed(2)).toBe("600.00");
    },
    TIMEOUT_MS
  );

  it(
    "segundo pagamento que completa o saldo: fecha PAGA",
    async () => {
      const f = await criarFixture({ valor: 1000 });
      await logarComo(f.usuarioId);

      await marcarComoPaga(null, formDataDe({ despesaId: f.despesaId, formaPagamento: "PIX", valor: "400" }));
      const resultado = await marcarComoPaga(
        null,
        formDataDe({ despesaId: f.despesaId, formaPagamento: "BOLETO", valor: "600" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toBe("Despesa marcada como paga.");
      const despesa = await prisma.despesa.findUniqueOrThrow({ where: { id: f.despesaId } });
      expect(despesa.status).toBe("PAGA");
      expect(despesa.pagoEm).not.toBeNull();
      const pagamentos = await prisma.pagamentoDespesa.findMany({ where: { despesaId: f.despesaId } });
      expect(pagamentos).toHaveLength(2);
      const soma = pagamentos.reduce((s, p) => s + Number(p.valor), 0);
      expect(soma).toBe(1000);
    },
    TIMEOUT_MS
  );

  it(
    "valor MAIOR que o saldo em aberto: rejeitado com mensagem clara, nada é alterado",
    async () => {
      const f = await criarFixture({ valor: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await marcarComoPaga(
        null,
        formDataDe({ despesaId: f.despesaId, formaPagamento: "PIX", valor: "1000.01" })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("maior que o saldo em aberto");
      const despesa = await prisma.despesa.findUniqueOrThrow({ where: { id: f.despesaId } });
      expect(despesa.status).toBe("PENDENTE");
      const pagamentos = await prisma.pagamentoDespesa.findMany({ where: { despesaId: f.despesaId } });
      expect(pagamentos).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "marcarComoPendente depois de uma baixa parcial: apaga as linhas de PagamentoDespesa e volta o saldo pro valor cheio",
    async () => {
      const f = await criarFixture({ valor: 1000 });
      await logarComo(f.usuarioId);

      await marcarComoPaga(null, formDataDe({ despesaId: f.despesaId, formaPagamento: "PIX", valor: "400" }));
      const resultado = await marcarComoPendente(null, formDataDe({ despesaId: f.despesaId }));

      expect(resultado.ok).toBe(true);
      const despesa = await prisma.despesa.findUniqueOrThrow({ where: { id: f.despesaId } });
      expect(despesa.status).toBe("PENDENTE");
      expect(despesa.pagoEm).toBeNull();
      expect(despesa.formaPagamento).toBeNull();
      const pagamentos = await prisma.pagamentoDespesa.findMany({ where: { despesaId: f.despesaId } });
      expect(pagamentos).toHaveLength(0);
      const saldo = await saldoDespesa(prisma, despesa);
      expect(saldo.toFixed(2)).toBe("1000.00");
    },
    TIMEOUT_MS
  );
});
