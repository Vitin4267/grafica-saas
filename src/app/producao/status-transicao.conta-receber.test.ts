import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import { gerarContasReceberDaEntrega } from "@/lib/condicao-pagamento";
import type { StatusPedido } from "@/generated/prisma/enums";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de status-transicao.apontamento.test.ts) — cobre o achado R1
// da auditoria de abrangência (Parte 7, 2026-09-03): gatilho ENTREGA de
// gerarContasReceberDaEntrega (ver src/lib/condicao-pagamento.ts), plumbado
// dentro da MESMA transação que avança Pedido.status pra ENTREGUE em
// avancarStatusPedido.
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
};

async function criarCondicao(
  graficaId: string,
  opts: {
    nome: string;
    ancora: "APROVACAO" | "EMISSAO_NOTA" | "ENTREGA" | "OUTRO";
    parcelas: { ordem: number; percentual: number; diasAposAncora: number }[];
  }
) {
  return prisma.condicaoPagamento.create({
    data: { graficaId, nome: opts.nome, ancora: opts.ancora, parcelas: { create: opts.parcelas } },
  });
}

// Fixture nasce com o pedido já em EXPEDICAO (penúltimo estágio de
// SEQUENCIA_STATUS_PEDIDO) — um único avancarStatusPedido já leva direto pra
// ENTREGUE, sem precisar simular toda a esteira de produção (fora de escopo
// deste teste, já coberto em status-transicao.custo-automatico.test.ts e
// status-transicao.apontamento.test.ts).
async function criarFixturePedido(opts: {
  total: number;
  condicaoPagamentoId?: string | null;
}): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Entrega ContaReceber ${s}`, slug: `teste-entrega-conta-receber-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-entrega-cr-${s}@example.com`, senhaHash: "x" },
  });
  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto ${s}` },
  });
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
  });
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: usuario.id,
      status: "APROVADO",
      total: opts.total,
      condicaoPagamentoId: opts.condicaoPagamentoId ?? null,
    },
  });
  await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: produto.id,
      quantidade: 1,
      precoUnitario: opts.total,
      precoTotal: opts.total,
    },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "EXPEDICAO" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return { graficaId: grafica.id, clienteId: cliente.id, orcamentoId: orcamento.id, pedidoId: pedido.id };
}

function pedidoParaAvanco(f: Fixture, status: StatusPedido, opts: { total: number; condicaoPagamentoId: string | null }): PedidoParaAvanco {
  return {
    id: f.pedidoId,
    graficaId: f.graficaId,
    orcamentoId: f.orcamentoId,
    status,
    arteUrl: null,
    arteAprovadaEm: null,
    producaoLinkToken: null,
    orcamento: {
      clienteId: f.clienteId,
      condicaoPagamentoId: opts.condicaoPagamentoId,
      total: opts.total,
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [{ quantidade: 1, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
    },
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.apontamentoEtapa.deleteMany({ where: { graficaId } }).catch(() => {});
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.condicaoPagamentoParcela.deleteMany({ where: { condicaoPagamento: { graficaId } } });
    await prisma.condicaoPagamento.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("transição pra ENTREGUE — geração automática de ContaReceber (achado R1)", () => {
  it(
    "sem condicaoPagamentoId: entrega normalmente, nenhuma ContaReceber é gerada — comportamento de hoje preservado",
    async () => {
      const f = await criarFixturePedido({ total: 400 });

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f, "EXPEDICAO", { total: 400, condicaoPagamentoId: null }),
        null,
        { origemConfirmacao: "APP", operadorId: null }
      );
      expect(resultado.ok).toBe(true);
      expect(resultado.ok && resultado.proximoStatus).toBe("ENTREGUE");

      const contas = await prisma.contaReceber.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(contas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "condicaoPagamentoId com âncora ENTREGA (50%+50%, 0/30 dias): a transição pra ENTREGUE gera as 2 ContaReceber",
    async () => {
      const f = await criarFixturePedido({ total: 1000 });
      const condicao = await criarCondicao(f.graficaId, {
        nome: "50% + 50% na entrega",
        ancora: "ENTREGA",
        parcelas: [
          { ordem: 1, percentual: 50, diasAposAncora: 0 },
          { ordem: 2, percentual: 50, diasAposAncora: 30 },
        ],
      });
      await prisma.orcamento.update({ where: { id: f.orcamentoId }, data: { condicaoPagamentoId: condicao.id } });

      // Antes da entrega: nenhuma conta ainda, mesmo o orçamento já
      // aprovado há tempo (a condição usa âncora ENTREGA, não APROVACAO).
      expect(await prisma.contaReceber.count({ where: { orcamentoId: f.orcamentoId } })).toBe(0);

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f, "EXPEDICAO", { total: 1000, condicaoPagamentoId: condicao.id }),
        null,
        { origemConfirmacao: "APP", operadorId: null }
      );
      expect(resultado.ok).toBe(true);

      const contas = await prisma.contaReceber.findMany({
        where: { orcamentoId: f.orcamentoId },
        orderBy: { vencimento: "asc" },
      });
      expect(contas).toHaveLength(2);
      const somaTotal = contas.reduce((soma, c) => soma + Number(c.valor), 0);
      expect(somaTotal).toBeCloseTo(1000, 2);
      expect(contas.every((c) => c.clienteId === f.clienteId)).toBe(true);
      expect(contas[0].descricao).toContain("50% + 50% na entrega");
    },
    TIMEOUT_MS
  );

  it(
    "idempotência (achado R1, item 5): reprocessar o gatilho ENTREGA pro mesmo orçamento não duplica ContaReceber",
    async () => {
      const f = await criarFixturePedido({ total: 600 });
      const condicao = await criarCondicao(f.graficaId, {
        nome: "1x na entrega",
        ancora: "ENTREGA",
        parcelas: [{ ordem: 1, percentual: 100, diasAposAncora: 0 }],
      });
      await prisma.orcamento.update({ where: { id: f.orcamentoId }, data: { condicaoPagamentoId: condicao.id } });

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco(f, "EXPEDICAO", { total: 600, condicaoPagamentoId: condicao.id }),
        null,
        { origemConfirmacao: "APP", operadorId: null }
      );
      expect(resultado.ok).toBe(true);
      expect(await prisma.contaReceber.count({ where: { orcamentoId: f.orcamentoId } })).toBe(1);

      // A transição pra ENTREGUE em si não pode ser repetida (é o último
      // estágio de SEQUENCIA_STATUS_PEDIDO — avancarStatusPedido barra com
      // "Este pedido já está no status final."), mas o gatilho em si
      // (gerarContasReceberDaEntrega) precisa ser seguro contra reentrada —
      // ex: reprocessamento manual do mesmo evento, ou uma futura chamada
      // duplicada por outro caminho. Chamando a função duas vezes direto,
      // simulando exatamente esse cenário.
      await prisma.$transaction(async (tx) => {
        await gerarContasReceberDaEntrega(tx, {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          clienteId: f.clienteId,
          condicaoPagamentoId: condicao.id,
          total: 600,
          entregueEm: new Date(),
        });
      });

      const contas = await prisma.contaReceber.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(contas).toHaveLength(1);
    },
    TIMEOUT_MS
  );
});
