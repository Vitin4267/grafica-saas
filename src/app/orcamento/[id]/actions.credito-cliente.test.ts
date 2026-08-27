import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { saldoCreditoCliente } from "@/lib/credito-cliente";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.limite-credito.test.ts) — cobre a parte 3 do
// achado A13 da auditoria de abrangência (2026-08-27): consumo automático do
// CreditoCliente na aprovação do orçamento (campo opcional "usarCredito" no
// form de OrcamentoAcoes.tsx). FALHA ESPERADA até a migration
// 20260827150000_credito_cliente ser aplicada ao banco.
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
import { atualizarStatusOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(opts: { depositoInicial?: number }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Credito Aprovacao ${s}`, slug: `teste-credito-aprovacao-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-credito-aprovacao-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 100, precoCompra: 1 },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "ENVIADO", total: 100 },
  });
  await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: itemGrafica.id, quantidade: 1, precoUnitario: 100, precoTotal: 100 },
  });

  let creditoClienteId: string | null = null;
  if (opts.depositoInicial) {
    const credito = await prisma.creditoCliente.create({ data: { clienteId: cliente.id } });
    creditoClienteId = credito.id;
    await prisma.movimentacaoCreditoCliente.create({
      data: { creditoClienteId: credito.id, tipo: "DEPOSITO", valor: opts.depositoInicial },
    });
  }

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, orcamentoId: orcamento.id, creditoClienteId };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.movimentacaoCreditoCliente.deleteMany({ where: { creditoCliente: { cliente: { graficaId } } } });
    await prisma.creditoCliente.deleteMany({ where: { cliente: { graficaId } } });
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.comissao.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
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

describe("aprovação de orçamento — consumo de crédito do cliente (achado A13)", () => {
  it(
    "sem usarCredito no form: aprova normal, nenhuma MovimentacaoCreditoCliente CONSUMO é criada",
    async () => {
      const f = await criarFixture({ depositoInicial: 200 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );

      expect(resultado.ok).toBe(true);
      const saldo = await saldoCreditoCliente(prisma, f.creditoClienteId!);
      expect(saldo.toFixed(2)).toBe("200.00");
    },
    TIMEOUT_MS
  );

  it(
    "usarCredito dentro do saldo disponível: aprova, cria Pedido e abate o valor do CreditoCliente vinculado ao orçamento",
    async () => {
      const f = await criarFixture({ depositoInicial: 200 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO", usarCredito: "60" })
      );

      expect(resultado.ok).toBe(true);
      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).not.toBeNull();

      const saldo = await saldoCreditoCliente(prisma, f.creditoClienteId!);
      expect(saldo.toFixed(2)).toBe("140.00");

      const consumo = await prisma.movimentacaoCreditoCliente.findFirst({
        where: { creditoClienteId: f.creditoClienteId!, tipo: "CONSUMO" },
      });
      expect(consumo?.orcamentoId).toBe(f.orcamentoId);
      expect(Number(consumo?.valor)).toBe(60);
    },
    TIMEOUT_MS
  );

  it(
    "usarCredito maior que o saldo disponível: aprovação inteira é rejeitada, nenhum Pedido é criado (rollback)",
    async () => {
      const f = await criarFixture({ depositoInicial: 50 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO", usarCredito: "51" })
      );

      expect(resultado.ok).toBe(false);

      // Rollback de verdade: nem o Pedido nem o status do orçamento mudaram.
      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).toBeNull();
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.status).toBe("ENVIADO");

      const saldo = await saldoCreditoCliente(prisma, f.creditoClienteId!);
      expect(saldo.toFixed(2)).toBe("50.00");
    },
    TIMEOUT_MS
  );

  it(
    "usarCredito preenchido mas cliente nunca teve CreditoCliente: aprovação rejeitada",
    async () => {
      const f = await criarFixture({});
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO", usarCredito: "10" })
      );

      expect(resultado.ok).toBe(false);
      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).toBeNull();
    },
    TIMEOUT_MS
  );
});
