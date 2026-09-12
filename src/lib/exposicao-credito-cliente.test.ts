import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularExposicaoCreditoCliente } from "./exposicao-credito-cliente";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de dre-query.test.ts) — cobre o achado N23 da Parte 9 da
// auditoria de código (2026-09-12): marcar uma ContaReceber como PERDA
// liberava o limite de crédito do caloteiro na hora, porque só PENDENTE/
// PARCIAL/EM_COBRANCA entravam nesta soma. Decisão do dono: PERDA continua
// bloqueando limite até uma revisão manual explícita
// (liberarLimiteContaReceberPerda).

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Exposicao Credito ${s}`, slug: `teste-exposicao-credito-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-exposicao-credito-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: 1000 },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, clienteId: cliente.id, orcamentoId: orcamento.id };
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
}, TIMEOUT_MS);

describe("calcularExposicaoCreditoCliente — PERDA (achado N23 da Parte 9)", () => {
  it(
    "conta PERDA sem limiteLiberadoEm continua contando na exposição (bloqueia novo crédito)",
    async () => {
      const f = await criarFixture();
      await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Calote",
          valor: 1000,
          vencimento: new Date("2026-01-01T00:00:00Z"),
          status: "PERDA",
          perdaEm: new Date(),
        },
      });

      const exposicao = await calcularExposicaoCreditoCliente(f.clienteId);
      expect(exposicao).toBe(1000);
    },
    TIMEOUT_MS
  );

  it(
    "conta PERDA com limiteLiberadoEm preenchido some da exposição (revisão manual já feita)",
    async () => {
      const f = await criarFixture();
      await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Calote revisado",
          valor: 1000,
          vencimento: new Date("2026-01-01T00:00:00Z"),
          status: "PERDA",
          perdaEm: new Date(),
          limiteLiberadoEm: new Date(),
        },
      });

      const exposicao = await calcularExposicaoCreditoCliente(f.clienteId);
      expect(exposicao).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "conta PERDA com baixa parcial anterior conta só pelo SALDO remanescente, não o valor cheio",
    async () => {
      const f = await criarFixture();
      const conta = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Calote parcialmente recebido antes",
          valor: 1000,
          vencimento: new Date("2026-01-01T00:00:00Z"),
          status: "PERDA",
          perdaEm: new Date(),
        },
      });
      const pagamento = await prisma.pagamento.create({
        data: { orcamentoId: f.orcamentoId, valor: 300, forma: "PIX" },
      });
      await prisma.baixaContaReceber.create({
        data: { contaReceberId: conta.id, pagamentoId: pagamento.id, valor: 300 },
      });

      const exposicao = await calcularExposicaoCreditoCliente(f.clienteId);
      expect(exposicao).toBe(700);
    },
    TIMEOUT_MS
  );

  it(
    "CANCELADO nunca conta (mesmo critério de sempre) — regressão zero",
    async () => {
      const f = await criarFixture();
      await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Cancelada",
          valor: 1000,
          vencimento: new Date("2026-01-01T00:00:00Z"),
          status: "CANCELADO",
        },
      });

      const exposicao = await calcularExposicaoCreditoCliente(f.clienteId);
      expect(exposicao).toBe(0);
    },
    TIMEOUT_MS
  );
});
