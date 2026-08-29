import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { saldoContaReceber } from "@/lib/baixa-financeira";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.credito-cliente.test.ts) — cobre o achado A8 da
// Parte 4 da auditoria de abrangência (2026-08-29): a reconciliação
// automática de registrarPagamento (que hoje só casa em valor EXATO com o
// TOTAL de uma ContaReceber PENDENTE — comentário "pagamento parcial ou com
// sobra não mexe em nada") ganha um segundo caminho, também de match EXATO,
// mas contra o SALDO REMANESCENTE de uma conta já PARCIAL. FALHA ESPERADA
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
import { registrarPagamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(opts: { total: number }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Baixa Parcial ${s}`, slug: `teste-baixa-parcial-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-baixa-parcial-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: opts.total, precoCompra: 1 },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: opts.total },
  });
  await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: itemGrafica.id,
      quantidade: 1,
      precoUnitario: opts.total,
      precoTotal: opts.total,
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, orcamentoId: orcamento.id };
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
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("registrarPagamento — reconciliação automática com ContaReceber (achado A8 da Parte 4)", () => {
  it(
    "valor EXATO com o total de uma conta PENDENTE: fecha ela pelo caminho antigo (regressão zero)",
    async () => {
      const f = await criarFixture({ total: 5000 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );
      const conta = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Parcela única",
          valor: 5000,
          vencimento: new Date("2026-09-01T00:00:00Z"),
        },
      });

      const resultado = await registrarPagamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, valor: "5000", forma: "PIX" })
      );

      expect(resultado.ok).toBe(true);
      const contaAtualizada = await prisma.contaReceber.findUniqueOrThrow({ where: { id: conta.id } });
      expect(contaAtualizada.status).toBe("RECEBIDO");
      expect(contaAtualizada.pagamentoId).not.toBeNull();
      const baixas = await prisma.baixaContaReceber.findMany({ where: { contaReceberId: conta.id } });
      expect(baixas).toHaveLength(0); // caminho antigo não grava BaixaContaReceber
    },
    TIMEOUT_MS
  );

  it(
    "valor EXATO com o SALDO REMANESCENTE de uma conta já PARCIAL: fecha ela via BaixaContaReceber (caminho novo)",
    async () => {
      const f = await criarFixture({ total: 5000 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );
      const conta = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Parcela única",
          valor: 5000,
          vencimento: new Date("2026-09-01T00:00:00Z"),
          status: "PARCIAL",
        },
      });
      // Baixa parcial prévia de R$3.000, simulando o que
      // registrarBaixaContaReceber já teria feito antes.
      const pagamentoPrevio = await prisma.pagamento.create({
        data: { orcamentoId: f.orcamentoId, valor: 3000, forma: "PIX" },
      });
      await prisma.baixaContaReceber.create({
        data: { contaReceberId: conta.id, pagamentoId: pagamentoPrevio.id, valor: 3000 },
      });

      // Segundo pagamento de R$2.000 — bate exato com o SALDO (5000-3000).
      const resultado = await registrarPagamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, valor: "2000", forma: "PIX" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toContain("marcada como recebida automaticamente");
      const contaAtualizada = await prisma.contaReceber.findUniqueOrThrow({ where: { id: conta.id } });
      expect(contaAtualizada.status).toBe("RECEBIDO");
      expect(contaAtualizada.pagamentoId).toBeNull(); // caminho novo nunca usa o campo legado
      const saldo = await saldoContaReceber(prisma, contaAtualizada);
      expect(saldo.toFixed(2)).toBe("0.00");
      const baixas = await prisma.baixaContaReceber.findMany({ where: { contaReceberId: conta.id } });
      expect(baixas).toHaveLength(2);
    },
    TIMEOUT_MS
  );

  it(
    "valor que não bate nem com o total nem com o saldo remanescente de nenhuma conta em aberto: Pagamento é criado sozinho, ContaReceber não é tocada (silêncio, nunca chute)",
    async () => {
      const f = await criarFixture({ total: 5000 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );
      const conta = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Parcela única",
          valor: 5000,
          vencimento: new Date("2026-09-01T00:00:00Z"),
          status: "PARCIAL",
        },
      });
      const pagamentoPrevio = await prisma.pagamento.create({
        data: { orcamentoId: f.orcamentoId, valor: 3000, forma: "PIX" },
      });
      await prisma.baixaContaReceber.create({
        data: { contaReceberId: conta.id, pagamentoId: pagamentoPrevio.id, valor: 3000 },
      });

      // Saldo remanescente é 2000, mas o pagamento é de 1500 — não bate com
      // nada (nem 5000 total, nem 2000 de saldo).
      const resultado = await registrarPagamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, valor: "1500", forma: "PIX" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).not.toContain("marcada como recebida automaticamente");
      const contaAtualizada = await prisma.contaReceber.findUniqueOrThrow({ where: { id: conta.id } });
      expect(contaAtualizada.status).toBe("PARCIAL"); // não mexeu
      const baixas = await prisma.baixaContaReceber.findMany({ where: { contaReceberId: conta.id } });
      expect(baixas).toHaveLength(1); // só a baixa prévia, nenhuma nova criada
      const pagamentos = await prisma.pagamento.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(pagamentos).toHaveLength(2); // o prévio + o novo (standalone)
    },
    TIMEOUT_MS
  );
});
