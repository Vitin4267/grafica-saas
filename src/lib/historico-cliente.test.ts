import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { buscarHistoricoCliente } from "./historico-cliente";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/credito-cliente.test.ts) — cobre o achado A10 da
// Parte 5 da auditoria de abrangência (2026-08-30): a ficha do cliente
// (/clientes/[id]) ganhou 3 blocos (últimos orçamentos/pedidos, faturamento
// no período, contas a receber em aberto/vencidas) — este arquivo testa a
// função que os alimenta, isolada de qualquer renderização React. FALHA
// ESPERADA até a migration 20260830160000_historico_financeiro_cliente ser
// aplicada ao banco (ContaReceber.clienteId e o índice
// [graficaId, clienteId] em Orcamento ainda não existem).
const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.baixaContaReceber.deleteMany({ where: { contaReceber: { graficaId } } });
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.pagamento.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Historico Cliente ${s}`, slug: `teste-historico-cliente-${s}` },
  });
  graficaIdsParaLimpar.push(grafica.id);

  const clienteAlvo = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente Alvo ${s}` } });
  // Outro cliente da MESMA gráfica — garante que o filtro é por clienteId,
  // não só por graficaId (ver comentário na proposta do achado sobre o
  // índice [graficaId, clienteId]).
  const clienteOutro = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente Outro ${s}` } });

  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-historico-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });

  const agora = new Date();

  // Orçamento aprovado do cliente-alvo, já promovido a Pedido — conta pro
  // faturamento do período e mostra o status do PEDIDO (não do orçamento) na
  // lista de recentes.
  const orcamentoAprovado = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: clienteAlvo.id,
      usuarioId: dono.id,
      status: "APROVADO",
      total: 500,
      createdAt: agora,
    },
  });
  await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamentoAprovado.id, status: "PRODUCAO" },
  });

  // Orçamento ainda em rascunho do mesmo cliente — aparece nos recentes, mas
  // não conta faturamento (buscarRelatorioNegocio só soma status=APROVADO).
  const orcamentoRascunho = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: clienteAlvo.id,
      usuarioId: dono.id,
      status: "RASCUNHO",
      total: 200,
      createdAt: new Date(agora.getTime() - 1000),
    },
  });

  // Orçamento aprovado do OUTRO cliente — nunca deveria aparecer no
  // histórico do cliente-alvo.
  const orcamentoOutroCliente = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: clienteOutro.id,
      usuarioId: dono.id,
      status: "APROVADO",
      total: 9_999,
      createdAt: agora,
    },
  });

  // Conta PENDENTE, a vencer — entra em contasEmAberto/totalEmAberto, mas não
  // em totalVencido.
  await prisma.contaReceber.create({
    data: {
      graficaId: grafica.id,
      orcamentoId: orcamentoAprovado.id,
      clienteId: clienteAlvo.id,
      descricao: "Parcela a vencer",
      valor: 300,
      vencimento: new Date(agora.getTime() + 30 * 86_400_000),
      status: "PENDENTE",
    },
  });

  // Conta PARCIAL, já vencida, com uma baixa de 150 — saldo esperado 250,
  // conta em totalEmAberto E totalVencido.
  const contaParcial = await prisma.contaReceber.create({
    data: {
      graficaId: grafica.id,
      orcamentoId: orcamentoAprovado.id,
      clienteId: clienteAlvo.id,
      descricao: "Parcela vencida parcial",
      valor: 400,
      vencimento: new Date("2020-01-01T00:00:00Z"),
      status: "PARCIAL",
    },
  });
  const pagamentoParcial = await prisma.pagamento.create({
    data: { orcamentoId: orcamentoAprovado.id, valor: 150, forma: "PIX" },
  });
  await prisma.baixaContaReceber.create({
    data: { contaReceberId: contaParcial.id, pagamentoId: pagamentoParcial.id, valor: 150 },
  });

  // Conta RECEBIDA — nunca deve aparecer em contasEmAberto.
  await prisma.contaReceber.create({
    data: {
      graficaId: grafica.id,
      orcamentoId: orcamentoAprovado.id,
      clienteId: clienteAlvo.id,
      descricao: "Parcela já recebida",
      valor: 100,
      vencimento: new Date("2020-01-01T00:00:00Z"),
      status: "RECEBIDO",
      recebidoEm: agora,
    },
  });

  // Conta do OUTRO cliente — nunca deve vazar pro histórico do cliente-alvo.
  await prisma.contaReceber.create({
    data: {
      graficaId: grafica.id,
      orcamentoId: orcamentoOutroCliente.id,
      clienteId: clienteOutro.id,
      descricao: "Parcela de outro cliente",
      valor: 9_999,
      vencimento: new Date(agora.getTime() + 30 * 86_400_000),
      status: "PENDENTE",
    },
  });

  return {
    graficaId: grafica.id,
    clienteAlvoId: clienteAlvo.id,
    orcamentoAprovadoId: orcamentoAprovado.id,
    orcamentoRascunhoId: orcamentoRascunho.id,
  };
}

describe("buscarHistoricoCliente (achado A10 da Parte 5)", () => {
  it(
    "retorna faturamento, orçamentos recentes e contas em aberto/vencidas isolados por cliente",
    async () => {
      const f = await criarFixture();

      const historico = await buscarHistoricoCliente(f.graficaId, f.clienteAlvoId);

      // Faturamento: só o orçamento APROVADO (500), nunca o rascunho (200)
      // nem o do outro cliente (9999).
      expect(historico.faturamentoPeriodo.faturado).toBeCloseTo(500, 2);
      expect(historico.faturamentoPeriodo.pedidos).toBe(1);

      // Orçamentos recentes: os 2 do cliente-alvo, mais novo primeiro — nunca
      // o do outro cliente.
      expect(historico.orcamentosRecentes.map((o) => o.id).sort()).toEqual(
        [f.orcamentoAprovadoId, f.orcamentoRascunhoId].sort()
      );
      const recenteAprovado = historico.orcamentosRecentes.find((o) => o.id === f.orcamentoAprovadoId)!;
      expect(recenteAprovado.statusPedido).toBe("PRODUCAO");
      const recenteRascunho = historico.orcamentosRecentes.find((o) => o.id === f.orcamentoRascunhoId)!;
      expect(recenteRascunho.statusPedido).toBeNull();
      expect(recenteRascunho.status).toBe("RASCUNHO");

      // Contas em aberto: PENDENTE (300) + PARCIAL com saldo 250 (400 - 150)
      // = 550 — nunca a RECEBIDA (100) nem a do outro cliente (9999).
      expect(historico.contasEmAberto).toHaveLength(2);
      expect(historico.totalEmAberto).toBeCloseTo(550, 2);

      const parcial = historico.contasEmAberto.find((c) => c.descricao === "Parcela vencida parcial")!;
      expect(parcial.saldo).toBeCloseTo(250, 2);
      expect(parcial.vencida).toBe(true);

      const aVencer = historico.contasEmAberto.find((c) => c.descricao === "Parcela a vencer")!;
      expect(aVencer.vencida).toBe(false);

      // Vencido: só a parcial (saldo 250) — a "a vencer" não conta.
      expect(historico.totalVencido).toBeCloseTo(250, 2);
    },
    TIMEOUT_MS
  );

  it(
    "cliente sem nenhum orçamento/conta: retorna listas vazias e zeros, sem erro",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Historico Vazio ${s}`, slug: `teste-historico-vazio-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente Vazio ${s}` } });

      const historico = await buscarHistoricoCliente(grafica.id, cliente.id);

      expect(historico.orcamentosRecentes).toHaveLength(0);
      expect(historico.contasEmAberto).toHaveLength(0);
      expect(historico.totalEmAberto).toBe(0);
      expect(historico.totalVencido).toBe(0);
      expect(historico.faturamentoPeriodo.faturado).toBe(0);
      expect(historico.faturamentoPeriodo.ticketMedio).toBeNull();
    },
    TIMEOUT_MS
  );
});
