import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import { garantirEtapasGraficaPadrao } from "@/lib/etapa-grafica";
import { SEQUENCIA_STATUS_PEDIDO } from "@/lib/producao-estagios";
import type { StatusPedido, ResultadoAprovacao } from "@/generated/prisma/enums";

// Achado D1 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md, 2026-09-11) — "Não existe aprovação
// intermediária dentro da produção". Teste de INTEGRAÇÃO de verdade (toca o
// Postgres de dev via DATABASE_URL), mesmo padrão de
// status-transicao.etapa-grafica.test.ts/arte-item.test.ts: cobre o TERCEIRO
// gate opt-in de avancarStatusPedido (ver EtapaGrafica.exigeAprovacaoQualidade
// e o gate correspondente em status-transicao.ts).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/server", () => ({ after: (tarefa: () => void) => tarefa() }));

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.aprovacaoProducao.deleteMany({ where: { graficaId } });
    await prisma.etapaGrafica.deleteMany({ where: { graficaId } });
    await prisma.responsavelEstagio.deleteMany({ where: { usuario: { graficaId } } });
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

// ---------------------------------------------------------------------------
// Fixture SEM ficha técnica (produto sem FichaTecnicaItem) — nenhum destes
// testes é sobre baixa de estoque, mesmo raciocínio de
// status-transicao.arte-item.test.ts/etapa-grafica.test.ts. statusInicial é
// sempre PRODUCAO->ACABAMENTO (nunca a transição de ENTRADA em PRODUCAO) de
// propósito: evita entrar no branch de baixa de estoque de
// avancarStatusPedido, que não é o que este arquivo testa.
type Fixture = {
  graficaId: string;
  orcamentoId: string;
  pedidoId: string;
};

async function criarFixture(
  statusInicial: StatusPedido,
  opts: { comApontamentoAberto?: boolean } = {}
): Promise<Fixture> {
  const comApontamentoAberto = opts.comApontamentoAberto ?? true;
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Aprovacao Producao ${s}`, slug: `teste-aprovacao-producao-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-aprovacao-producao-${s}@example.com`, senhaHash: "x" },
  });
  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto ${s}` },
  });
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 100 },
  });
  await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: produto.id, quantidade: 1, precoUnitario: 100, precoTotal: 100 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: statusInicial },
  });

  if (comApontamentoAberto) {
    await prisma.apontamentoEtapa.create({
      data: {
        graficaId: grafica.id,
        pedidoId: pedido.id,
        status: statusInicial,
        origemConfirmacao: "APP",
      },
    });
  }

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id };
}

function pedidoParaAvanco(f: Fixture, status: StatusPedido): PedidoParaAvanco {
  return {
    id: f.pedidoId,
    graficaId: f.graficaId,
    orcamentoId: f.orcamentoId,
    status,
    arteUrl: null,
    arteAprovadaEm: null,
    producaoLinkToken: null,
    orcamento: {
      clienteId: "cliente-teste",
      condicaoPagamentoId: null,
      total: 0,
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [{ quantidade: 1, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
    },
  };
}

async function ligarExigeAprovacao(graficaId: string, status: StatusPedido): Promise<void> {
  await garantirEtapasGraficaPadrao(graficaId);
  await prisma.etapaGrafica.update({
    where: { graficaId_status: { graficaId, status } },
    data: { exigeAprovacaoQualidade: true },
  });
}

async function criarAprovacao(
  f: Fixture,
  resultado: ResultadoAprovacao,
  apontamentoEtapaId: string | null | undefined
): Promise<void> {
  await prisma.aprovacaoProducao.create({
    data: {
      graficaId: f.graficaId,
      pedidoId: f.pedidoId,
      apontamentoEtapaId: apontamentoEtapaId ?? null,
      tipo: "OK_MAQUINA",
      resultado,
    },
  });
}

// ---------------------------------------------------------------------------

describe("Gate de AprovacaoProducao — achado D1 (aprovação de qualidade dentro da produção)", () => {
  it(
    "bloqueia a transição quando a etapa exige aprovação e nenhuma AprovacaoProducao existe",
    async () => {
      const f = await criarFixture("PRODUCAO");
      await ligarExigeAprovacao(f.graficaId, "PRODUCAO");

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "PRODUCAO"), "[]");

      expect(resultado.ok).toBe(false);
      if (resultado.ok) throw new Error("unreachable");
      expect(resultado.mensagem).toMatch(/exige aprovação de qualidade/i);

      const pedidoDepois = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoDepois.status).toBe("PRODUCAO");
    },
    TIMEOUT_MS
  );

  it(
    "libera a transição quando existe uma AprovacaoProducao com resultado APROVADO",
    async () => {
      const f = await criarFixture("PRODUCAO");
      await ligarExigeAprovacao(f.graficaId, "PRODUCAO");
      const apontamento = await prisma.apontamentoEtapa.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      await criarAprovacao(f, "APROVADO", apontamento.id);

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "PRODUCAO"), "[]");

      expect(resultado.ok).toBe(true);
      const pedidoDepois = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoDepois.status).toBe("ACABAMENTO");
    },
    TIMEOUT_MS
  );

  it(
    "libera a transição quando existe uma AprovacaoProducao com resultado APROVADO_COM_RESSALVA",
    async () => {
      const f = await criarFixture("PRODUCAO");
      await ligarExigeAprovacao(f.graficaId, "PRODUCAO");
      const apontamento = await prisma.apontamentoEtapa.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      await criarAprovacao(f, "APROVADO_COM_RESSALVA", apontamento.id);

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "PRODUCAO"), "[]");

      expect(resultado.ok).toBe(true);
      const pedidoDepois = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoDepois.status).toBe("ACABAMENTO");
    },
    TIMEOUT_MS
  );

  it(
    "continua bloqueando quando só existe uma AprovacaoProducao REPROVADO registrada (nunca libera)",
    async () => {
      const f = await criarFixture("PRODUCAO");
      await ligarExigeAprovacao(f.graficaId, "PRODUCAO");
      const apontamento = await prisma.apontamentoEtapa.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      await criarAprovacao(f, "REPROVADO", apontamento.id);

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "PRODUCAO"), "[]");

      expect(resultado.ok).toBe(false);
      if (resultado.ok) throw new Error("unreachable");
      expect(resultado.mensagem).toMatch(/reprovada/i);

      const pedidoDepois = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoDepois.status).toBe("PRODUCAO");
    },
    TIMEOUT_MS
  );

  it(
    "uma aprovação registrada numa passagem ANTERIOR (apontamento já fechado) por esta mesma etapa não libera a passagem ATUAL",
    async () => {
      const f = await criarFixture("PRODUCAO", { comApontamentoAberto: false });
      await ligarExigeAprovacao(f.graficaId, "PRODUCAO");

      // Simula um pedido retrabalhado: já passou por PRODUCAO uma vez (com
      // aprovação registrada e o apontamento fechado) e voltou a passar por
      // ela de novo agora (novo apontamento aberto, sem aprovação nenhuma
      // ainda pra ESTA rodada).
      const apontamentoAntigo = await prisma.apontamentoEtapa.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          status: "PRODUCAO",
          origemConfirmacao: "APP",
          finalizadoEm: new Date(),
        },
      });
      await criarAprovacao(f, "APROVADO", apontamentoAntigo.id);
      await prisma.apontamentoEtapa.create({
        data: { graficaId: f.graficaId, pedidoId: f.pedidoId, status: "PRODUCAO", origemConfirmacao: "APP" },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "PRODUCAO"), "[]");

      expect(resultado.ok).toBe(false);
      if (resultado.ok) throw new Error("unreachable");
      expect(resultado.mensagem).toMatch(/exige aprovação de qualidade/i);
    },
    TIMEOUT_MS
  );

  it(
    "sem nenhum apontamento aberto pra esta etapa (caso-limite), cai no fallback por pedidoId",
    async () => {
      const f = await criarFixture("PRODUCAO", { comApontamentoAberto: false });
      await ligarExigeAprovacao(f.graficaId, "PRODUCAO");
      await criarAprovacao(f, "APROVADO", null);

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "PRODUCAO"), "[]");

      expect(resultado.ok).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "regressão zero: gráfica que NUNCA liga exigeAprovacaoQualidade em nenhuma etapa passa por TODAS as transições exatamente como antes",
    async () => {
      const f = await criarFixture("ARTE", { comApontamentoAberto: false });
      // Nenhuma EtapaGrafica configurada — mesmo cenário "bootstrap lazy"
      // dos demais testes de regressão desta suíte (status-transicao.etapa-grafica.test.ts).

      let statusAtual: StatusPedido = "ARTE";
      for (let i = 0; i < SEQUENCIA_STATUS_PEDIDO.length - 1; i++) {
        const resultado = await avancarStatusPedido(pedidoParaAvanco(f, statusAtual), "[]");
        expect(resultado.ok).toBe(true);
        if (!resultado.ok) throw new Error("unreachable");
        statusAtual = resultado.proximoStatus;
      }
      expect(statusAtual).toBe("ENTREGUE");

      const pedidoFinal = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoFinal.status).toBe("ENTREGUE");
    },
    TIMEOUT_MS
  );
});
