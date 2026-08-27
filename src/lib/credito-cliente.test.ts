import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { D } from "@/lib/pricing/decimal";
import { saldoCreditoCliente, lancarMovimentacaoManualCreditoCliente, lancarConsumoCreditoCliente } from "./credito-cliente";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/custo-pedido.test.ts) — cobre o achado A13 da
// auditoria de abrangência (2026-08-27): CreditoCliente/MovimentacaoCreditoCliente,
// o par simétrico de ContaPrepaga pro saldo adiantado que um CLIENTE tem
// com a gráfica (não o oposto).
//
// FALHA ESPERADA até a migration 20260827150000_credito_cliente ser aplicada
// ao banco (as tabelas ainda não existem) — não é regressão deste código.
const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.movimentacaoCreditoCliente.deleteMany({ where: { creditoCliente: { cliente: { graficaId } } } });
    await prisma.creditoCliente.deleteMany({ where: { cliente: { graficaId } } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Credito Cliente ${s}`, slug: `teste-credito-cliente-${s}` },
  });
  graficaIdsParaLimpar.push(grafica.id);
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-credito-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "ENVIADO", total: 100 },
  });
  return { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, orcamentoId: orcamento.id };
}

describe("saldoCreditoCliente", () => {
  it(
    "soma DEPOSITO, subtrai CONSUMO, soma ESTORNO e AJUSTE (com sinal) corretamente",
    async () => {
      const f = await criarFixture();

      const deposito = await lancarMovimentacaoManualCreditoCliente(prisma, {
        clienteId: f.clienteId,
        tipo: "DEPOSITO",
        valor: new D(500),
        criadoPorId: f.usuarioId,
      });
      expect(deposito.ok).toBe(true);

      const credito = await prisma.creditoCliente.findUniqueOrThrow({ where: { clienteId: f.clienteId } });
      expect((await saldoCreditoCliente(prisma, credito.id)).toFixed(2)).toBe("500.00");

      const consumo = await prisma.$transaction((tx) =>
        lancarConsumoCreditoCliente(tx, {
          clienteId: f.clienteId,
          orcamentoId: f.orcamentoId,
          valor: new D(120),
          criadoPorId: f.usuarioId,
        })
      );
      expect(consumo.ok).toBe(true);
      expect((await saldoCreditoCliente(prisma, credito.id)).toFixed(2)).toBe("380.00");

      const estorno = await lancarMovimentacaoManualCreditoCliente(prisma, {
        clienteId: f.clienteId,
        tipo: "ESTORNO",
        valor: new D(120),
        criadoPorId: f.usuarioId,
      });
      expect(estorno.ok).toBe(true);
      expect((await saldoCreditoCliente(prisma, credito.id)).toFixed(2)).toBe("500.00");

      // AJUSTE negativo (correção de lançamento a mais) — valor já vem
      // sinalizado, soma direto sem inverter (ver SINAL_TIPO em credito-cliente.ts).
      const ajuste = await lancarMovimentacaoManualCreditoCliente(prisma, {
        clienteId: f.clienteId,
        tipo: "AJUSTE",
        valor: new D(-50),
        criadoPorId: f.usuarioId,
      });
      expect(ajuste.ok).toBe(true);
      expect((await saldoCreditoCliente(prisma, credito.id)).toFixed(2)).toBe("450.00");
    },
    TIMEOUT_MS
  );
});

describe("lancarConsumoCreditoCliente", () => {
  it(
    "consome exatamente o saldo disponível — permitido, saldo final zero",
    async () => {
      const f = await criarFixture();
      await lancarMovimentacaoManualCreditoCliente(prisma, {
        clienteId: f.clienteId,
        tipo: "DEPOSITO",
        valor: new D(100),
        criadoPorId: f.usuarioId,
      });
      const credito = await prisma.creditoCliente.findUniqueOrThrow({ where: { clienteId: f.clienteId } });

      const resultado = await prisma.$transaction((tx) =>
        lancarConsumoCreditoCliente(tx, {
          clienteId: f.clienteId,
          orcamentoId: f.orcamentoId,
          valor: new D(100),
          criadoPorId: f.usuarioId,
        })
      );

      expect(resultado.ok).toBe(true);
      expect((await saldoCreditoCliente(prisma, credito.id)).toFixed(2)).toBe("0.00");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita consumo maior que o saldo disponível — nenhuma movimentação é criada",
    async () => {
      const f = await criarFixture();
      await lancarMovimentacaoManualCreditoCliente(prisma, {
        clienteId: f.clienteId,
        tipo: "DEPOSITO",
        valor: new D(100),
        criadoPorId: f.usuarioId,
      });
      const credito = await prisma.creditoCliente.findUniqueOrThrow({ where: { clienteId: f.clienteId } });

      const resultado = await prisma.$transaction((tx) =>
        lancarConsumoCreditoCliente(tx, {
          clienteId: f.clienteId,
          orcamentoId: f.orcamentoId,
          valor: new D(100.01),
          criadoPorId: f.usuarioId,
        })
      );

      expect(resultado.ok).toBe(false);
      // Saldo continua intacto — a tentativa rejeitada não deixou resto nenhum.
      expect((await saldoCreditoCliente(prisma, credito.id)).toFixed(2)).toBe("100.00");
      const movimentacoes = await prisma.movimentacaoCreditoCliente.findMany({
        where: { creditoClienteId: credito.id },
      });
      expect(movimentacoes).toHaveLength(1); // só o depósito original
    },
    TIMEOUT_MS
  );

  it(
    "cliente sem CreditoCliente nenhum (nunca recebeu depósito): rejeita com mensagem clara",
    async () => {
      const f = await criarFixture();

      const resultado = await prisma.$transaction((tx) =>
        lancarConsumoCreditoCliente(tx, {
          clienteId: f.clienteId,
          orcamentoId: f.orcamentoId,
          valor: new D(10),
          criadoPorId: f.usuarioId,
        })
      );

      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );
});
