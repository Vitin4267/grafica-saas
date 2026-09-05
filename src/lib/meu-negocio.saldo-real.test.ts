import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { buscarVisaoGeralNegocio } from "@/lib/meu-negocio";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de meu-negocio.test.ts) — cobre a CORREÇÃO do achado A3 da
// Parte 4 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// 2026-09-05): saldoReal misturava faturamentoTotal (Orcamento aprovado por
// data de CRIAÇÃO — competência) com despesasPagasTotal (caixa). Agora os
// dois lados são caixa: Pagamento.createdAt − Despesa paga.

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = { graficaId: string; usuarioId: string; clienteId: string };

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Saldo Real ${s}`, slug: `teste-saldo-real-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-saldo-real-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  return { graficaId: grafica.id, usuarioId: usuario.id, clienteId: cliente.id };
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.pagamento.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.etapaGrafica.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("buscarVisaoGeralNegocio — saldoReal (correção do achado A3)", () => {
  it(
    "NÃO conta o total de um orçamento aprovado sem nenhum pagamento recebido — regressão do bug original",
    async () => {
      const f = await criarFixture();
      graficaIdsParaLimpar.push(f.graficaId);

      // Orçamento de R$80 mil aprovado agora, SEM nenhum Pagamento — o bug
      // original faria este valor inteiro aparecer em saldoReal.
      await prisma.orcamento.create({
        data: {
          graficaId: f.graficaId,
          clienteId: f.clienteId,
          usuarioId: f.usuarioId,
          status: "APROVADO",
          total: 80_000,
        },
      });

      await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa paga",
          valor: 400,
          vencimento: new Date("2020-01-01T00:00:00Z"),
          status: "PAGA",
          pagoEm: new Date(),
        },
      });

      const visao = await buscarVisaoGeralNegocio(f.graficaId);

      // saldoReal = 0 (nenhum pagamento recebido) - 400 (despesa paga) = -400,
      // NUNCA 80.000 - 400 = 79.600 (comportamento antigo, competência).
      expect(visao.saldoReal).toBe(-400);
      // faturamentoMes.total continua sendo a métrica de competência de
      // sempre — não foi essa que devia mudar, só saldoReal.
      expect(visao.faturamentoMes.total).toBe(80_000);
    },
    TIMEOUT_MS
  );

  it(
    "conta só o Pagamento efetivamente recebido, mesmo quando o orçamento aprovado vale muito mais (parcelamento)",
    async () => {
      const f = await criarFixture();
      graficaIdsParaLimpar.push(f.graficaId);

      const orcamento = await prisma.orcamento.create({
        data: {
          graficaId: f.graficaId,
          clienteId: f.clienteId,
          usuarioId: f.usuarioId,
          status: "APROVADO",
          total: 80_000,
        },
      });

      // Só a entrada de R$1.000 foi recebida até agora (restante parcelado
      // em 90 dias, ainda não vencido).
      await prisma.pagamento.create({
        data: { orcamentoId: orcamento.id, valor: 1_000, forma: "PIX" },
      });

      await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa paga",
          valor: 300,
          vencimento: new Date("2020-01-01T00:00:00Z"),
          status: "PAGA",
          pagoEm: new Date(),
        },
      });

      const visao = await buscarVisaoGeralNegocio(f.graficaId);

      expect(visao.saldoReal).toBe(700); // 1.000 - 300, nunca 79.700
    },
    TIMEOUT_MS
  );

  it(
    "soma múltiplos pagamentos do mês, de orçamentos diferentes",
    async () => {
      const f = await criarFixture();
      graficaIdsParaLimpar.push(f.graficaId);

      const orcamento1 = await prisma.orcamento.create({
        data: {
          graficaId: f.graficaId,
          clienteId: f.clienteId,
          usuarioId: f.usuarioId,
          status: "APROVADO",
          total: 2_000,
        },
      });
      const orcamento2 = await prisma.orcamento.create({
        data: {
          graficaId: f.graficaId,
          clienteId: f.clienteId,
          usuarioId: f.usuarioId,
          status: "APROVADO",
          total: 3_000,
        },
      });
      await prisma.pagamento.create({
        data: { orcamentoId: orcamento1.id, valor: 2_000, forma: "PIX" },
      });
      await prisma.pagamento.create({
        data: { orcamentoId: orcamento2.id, valor: 3_000, forma: "CARTAO" },
      });

      const visao = await buscarVisaoGeralNegocio(f.graficaId);

      expect(visao.saldoReal).toBe(5_000);
    },
    TIMEOUT_MS
  );

  it(
    "isola por gráfica: Pagamento de outro tenant nunca soma no saldoReal desta gráfica",
    async () => {
      const f = await criarFixture();
      const outra = await criarFixture();
      graficaIdsParaLimpar.push(f.graficaId, outra.graficaId);

      const orcamentoOutraGrafica = await prisma.orcamento.create({
        data: {
          graficaId: outra.graficaId,
          clienteId: outra.clienteId,
          usuarioId: outra.usuarioId,
          status: "APROVADO",
          total: 50_000,
        },
      });
      await prisma.pagamento.create({
        data: { orcamentoId: orcamentoOutraGrafica.id, valor: 50_000, forma: "PIX" },
      });

      const visao = await buscarVisaoGeralNegocio(f.graficaId);

      expect(visao.saldoReal).toBe(0);
    },
    TIMEOUT_MS
  );
});
