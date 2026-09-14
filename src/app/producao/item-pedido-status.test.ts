import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de parada-pedido.test.ts) — cobre o achado F3 da auditoria de
// abrangência (2026-09-14, escopo reduzido): marcar/desmarcar item de pedido
// concluído (toggle idempotente), RBAC de Produção, isolamento de tenant, e
// que a mudança NUNCA toca Pedido.status (garantia central do achado —
// aditivo/paralelo, não substitui a FSM de status-transicao.ts).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260914173000_item_pedido_status/migration.sql tiver
// sido aplicada no banco.
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
import { alternarItemPedidoConcluido } from "./item-pedido-status-actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string;
  pedidoId: string;
  orcamentoItemId: string;
  outroOrcamentoItemId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Item Pedido Status ${s}`, slug: `teste-item-pedido-status-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-ips-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-ips-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const itemCatalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Banners", nome: `Banner ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: itemCatalogo.id },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "APROVADO", total: 500 },
  });
  const orcamentoItem = await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: itemGrafica.id, quantidade: 2, precoUnitario: 100, precoTotal: 200 },
  });
  const outroOrcamentoItem = await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: itemGrafica.id, quantidade: 1, precoUnitario: 50, precoTotal: 50 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "PRODUCAO" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    pedidoId: pedido.id,
    orcamentoItemId: orcamentoItem.id,
    outroOrcamentoItemId: outroOrcamentoItem.id,
  };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function autenticarComo(usuarioId: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(usuario as never);
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.itemPedidoStatus.deleteMany({ where: { graficaId } });
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

describe("alternarItemPedidoConcluido (RBAC + toggle, achado F3)", () => {
  it(
    "OPERADOR sem PRODUCAO.podeEditar é rejeitado, nenhuma linha é criada",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioOperadorId);

      const resultado = await alternarItemPedidoConcluido(
        null,
        formDataDe({ pedidoId: f.pedidoId, orcamentoItemId: f.orcamentoItemId, concluido: "on" })
      );
      expect(resultado.ok).toBe(false);

      const linhas = await prisma.itemPedidoStatus.findMany({ where: { pedidoId: f.pedidoId } });
      expect(linhas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "DONO marca um item como concluído — cria a linha, NÃO mexe em Pedido.status",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await alternarItemPedidoConcluido(
        null,
        formDataDe({ pedidoId: f.pedidoId, orcamentoItemId: f.orcamentoItemId, concluido: "on" })
      );
      expect(resultado.ok).toBe(true);

      const linha = await prisma.itemPedidoStatus.findUniqueOrThrow({
        where: { pedidoId_orcamentoItemId: { pedidoId: f.pedidoId, orcamentoItemId: f.orcamentoItemId } },
      });
      expect(linha.concluidoPorId).toBe(f.usuarioDonoId);

      // Garantia central do achado — aditivo/paralelo, nunca toca status.
      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.status).toBe("PRODUCAO");
    },
    TIMEOUT_MS
  );

  it(
    "desmarcar apaga a linha (toggle idempotente)",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      await alternarItemPedidoConcluido(
        null,
        formDataDe({ pedidoId: f.pedidoId, orcamentoItemId: f.orcamentoItemId, concluido: "on" })
      );
      const resultado = await alternarItemPedidoConcluido(
        null,
        formDataDe({ pedidoId: f.pedidoId, orcamentoItemId: f.orcamentoItemId })
      );
      expect(resultado.ok).toBe(true);

      const linhas = await prisma.itemPedidoStatus.findMany({ where: { pedidoId: f.pedidoId } });
      expect(linhas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "marcar 2 vezes seguidas não duplica (upsert, índice único pedidoId+orcamentoItemId)",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      await alternarItemPedidoConcluido(
        null,
        formDataDe({ pedidoId: f.pedidoId, orcamentoItemId: f.orcamentoItemId, concluido: "on" })
      );
      await alternarItemPedidoConcluido(
        null,
        formDataDe({ pedidoId: f.pedidoId, orcamentoItemId: f.orcamentoItemId, concluido: "on" })
      );

      const linhas = await prisma.itemPedidoStatus.findMany({ where: { pedidoId: f.pedidoId } });
      expect(linhas).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "marcar dois itens diferentes do mesmo pedido cria duas linhas independentes",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      await alternarItemPedidoConcluido(
        null,
        formDataDe({ pedidoId: f.pedidoId, orcamentoItemId: f.orcamentoItemId, concluido: "on" })
      );
      await alternarItemPedidoConcluido(
        null,
        formDataDe({ pedidoId: f.pedidoId, orcamentoItemId: f.outroOrcamentoItemId, concluido: "on" })
      );

      const linhas = await prisma.itemPedidoStatus.findMany({ where: { pedidoId: f.pedidoId } });
      expect(linhas).toHaveLength(2);
    },
    TIMEOUT_MS
  );

  it(
    "item que não pertence ao pedido informado é rejeitado (isolamento entre pedidos/tenant)",
    async () => {
      const f = await criarFixture();
      const outraGrafica = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await alternarItemPedidoConcluido(
        null,
        formDataDe({
          pedidoId: f.pedidoId,
          orcamentoItemId: outraGrafica.orcamentoItemId,
          concluido: "on",
        })
      );
      expect(resultado.ok).toBe(false);

      const linhas = await prisma.itemPedidoStatus.findMany({ where: { pedidoId: f.pedidoId } });
      expect(linhas).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
