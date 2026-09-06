import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import type { StatusPedido } from "@/generated/prisma/enums";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de status-transicao.apontamento.test.ts/conta-receber.test.ts)
// — cobre o achado F5 da auditoria de abrangência (Parte 7, 2026-09-05): o
// gate de ArteItem em avancarStatusPedido (src/app/producao/status-transicao.ts)
// tem que bloquear a saída de ARTE enquanto existir alguma ArteItem
// pendente deste pedido, e NUNCA bloquear quando nenhuma ArteItem existe
// (regressão zero pra quem só usa Pedido.arteUrl/arteAprovadaEm de
// cabeçalho, como sempre).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

type Fixture = {
  graficaId: string;
  clienteId: string;
  orcamentoId: string;
  pedidoId: string;
  orcamentoItemId: string;
  orcamentoItemId2: string;
};

// Fixture nasce com o pedido já em ARTE, com 2 OrcamentoItem (mesmo cenário
// do achado F5 — pedido com itens diferentes, cada um podendo ter sua
// própria arte/aprovação).
async function criarFixturePedido(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Arte Item ${s}`, slug: `teste-arte-item-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-arte-item-${s}@example.com`, senhaHash: "x" },
  });
  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Rótulo", nome: `Produto ${s}` },
  });
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 200 },
  });
  const item1 = await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: produto.id, quantidade: 1, precoUnitario: 100, precoTotal: 100 },
  });
  const item2 = await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: produto.id, quantidade: 1, precoUnitario: 100, precoTotal: 100 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "ARTE" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    clienteId: cliente.id,
    orcamentoId: orcamento.id,
    pedidoId: pedido.id,
    orcamentoItemId: item1.id,
    orcamentoItemId2: item2.id,
  };
}

function pedidoParaAvanco(
  f: Fixture,
  status: StatusPedido,
  opts: { arteUrl?: string | null; arteAprovadaEm?: Date | null } = {}
): PedidoParaAvanco {
  return {
    id: f.pedidoId,
    graficaId: f.graficaId,
    orcamentoId: f.orcamentoId,
    status,
    arteUrl: opts.arteUrl ?? null,
    arteAprovadaEm: opts.arteAprovadaEm ?? null,
    producaoLinkToken: null,
    orcamento: {
      clienteId: f.clienteId,
      condicaoPagamentoId: null,
      total: 200,
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [
        { quantidade: 1, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } },
        { quantidade: 1, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } },
      ],
    },
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.arteItem.deleteMany({ where: { orcamentoItem: { orcamento: { graficaId } } } });
    await prisma.apontamentoEtapa.deleteMany({ where: { graficaId } }).catch(() => {});
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
}, TIMEOUT_MS);

describe("Gate de ArteItem — achado F5 (arte por item)", () => {
  it(
    "avança normalmente quando NENHUMA ArteItem existe pra este pedido (regressão zero)",
    async () => {
      const f = await criarFixturePedido();

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "ARTE"), "[]");

      expect(resultado.ok).toBe(true);
      const pedidoAtualizado = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoAtualizado.status).toBe("CLICHE_FACA");
    },
    TIMEOUT_MS
  );

  it(
    "bloqueia quando existe 1 ArteItem pendente (não aprovada) deste pedido",
    async () => {
      const f = await criarFixturePedido();
      await prisma.arteItem.create({
        data: { orcamentoItemId: f.orcamentoItemId, pedidoId: f.pedidoId, url: "https://exemplo.com/arte1.pdf" },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "ARTE"), "[]");

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.mensagem).toMatch(/1 item/);
      }
      const pedidoAtualizado = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoAtualizado.status).toBe("ARTE");
    },
    TIMEOUT_MS
  );

  it(
    "bloqueia e conta corretamente quando existem 2 ArteItem pendentes (itens de tamanhos diferentes)",
    async () => {
      const f = await criarFixturePedido();
      await prisma.arteItem.create({
        data: { orcamentoItemId: f.orcamentoItemId, pedidoId: f.pedidoId, url: "https://exemplo.com/arte1.pdf" },
      });
      await prisma.arteItem.create({
        data: { orcamentoItemId: f.orcamentoItemId2, pedidoId: f.pedidoId, url: "https://exemplo.com/arte2.pdf" },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "ARTE"), "[]");

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.mensagem).toMatch(/2 itens/);
      }
    },
    TIMEOUT_MS
  );

  it(
    "avança normalmente quando TODAS as ArteItem deste pedido já estão aprovadas",
    async () => {
      const f = await criarFixturePedido();
      await prisma.arteItem.create({
        data: {
          orcamentoItemId: f.orcamentoItemId,
          pedidoId: f.pedidoId,
          url: "https://exemplo.com/arte1.pdf",
          aprovadaEm: new Date(),
          respondidaPor: "Cliente Teste",
        },
      });
      await prisma.arteItem.create({
        data: {
          orcamentoItemId: f.orcamentoItemId2,
          pedidoId: f.pedidoId,
          url: "https://exemplo.com/arte2.pdf",
          aprovadaEm: new Date(),
          respondidaPor: "Cliente Teste",
        },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "ARTE"), "[]");

      expect(resultado.ok).toBe(true);
      const pedidoAtualizado = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoAtualizado.status).toBe("CLICHE_FACA");
    },
    TIMEOUT_MS
  );

  it(
    "uma ArteItem com pedidoId NULL (preview de orçamento, ainda sem Pedido de verdade) nunca bloqueia o gate",
    async () => {
      const f = await criarFixturePedido();
      // Simula uma arte por item enviada ainda em RASCUNHO, antes da
      // aprovação virar Pedido — pedidoId fica null até o backfill da
      // aprovação (ver comentário em enviarArteItem/status.ts). Não deveria
      // gatear NENHUM pedido, já que não pertence a nenhum.
      await prisma.arteItem.create({
        data: { orcamentoItemId: f.orcamentoItemId, pedidoId: null, url: "https://exemplo.com/preview.pdf" },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "ARTE"), "[]");

      expect(resultado.ok).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "gate de cabeçalho (Pedido.arteUrl/arteAprovadaEm) continua funcionando sem nenhuma ArteItem, sem mudança de comportamento",
    async () => {
      const f = await criarFixturePedido();

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f, "ARTE", { arteUrl: "https://exemplo.com/cabecalho.pdf", arteAprovadaEm: null }),
        "[]"
      );

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.mensagem).toMatch(/aprovada pelo cliente/);
      }
    },
    TIMEOUT_MS
  );
});
