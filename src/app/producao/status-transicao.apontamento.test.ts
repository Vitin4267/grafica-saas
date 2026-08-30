import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import {
  abrirApontamentoInicialSeNecessario,
  extrairEValidarSelecaoMaquina,
  sugerirMaquinaPedido,
  SELECAO_MAQUINA_VAZIA,
} from "@/lib/apontamento-etapa";
import type { StatusPedido } from "@/generated/prisma/enums";

// Achado B1/B2 da Parte 2 (Produção) da auditoria de abrangência: histórico
// de transição de etapa (ApontamentoEtapa) + máquina que produziu cada
// etapa. Mesmo padrão de teste de integração REAL (toca o Postgres de dev
// via DATABASE_URL) de status-transicao.custo-automatico.test.ts — mock só
// de next/cache (revalidatePath fora de uma requisição real derruba com
// "static generation store missing"; nenhuma asserção aqui depende disso).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  orcamentoId: string;
  pedidoId: string;
  prensaId: string;
  maquinaFlexografiaId: string;
};

// Fixture deliberadamente SEM ficha técnica (produto sem FichaTecnicaItem) —
// os testes deste arquivo são sobre ApontamentoEtapa, não sobre a baixa de
// estoque (já coberta em status-transicao.custo-automatico.test.ts). Sem
// ficha técnica, mesmo a transição CLICHE_FACA→PRODUCAO (que ENTRA no branch
// de baixa) não encontra nenhum item pra descontar — resolverPerdasConfirmadas
// aceita itens=[] trivialmente, então perdasJsonBruto="[]" sempre serve.
async function criarFixturePedido(status: StatusPedido): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Apontamento ${s}`, slug: `teste-apontamento-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-apontamento-${s}@example.com`, senhaHash: "x" },
  });
  const prensa = await prisma.prensa.create({ data: { graficaId: grafica.id, nome: `Prensa ${s}` } });
  const flexo = await prisma.maquinaFlexografia.create({
    data: { graficaId: grafica.id, nome: `Flexo ${s}` },
  });
  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto ${s}` },
  });
  // prensaId setado — alimenta os testes de sugerirMaquinaPedido.
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id, prensaId: prensa.id },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 100 },
  });
  await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: produto.id, quantidade: 1, precoUnitario: 100, precoTotal: 100 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioId: usuario.id,
    orcamentoId: orcamento.id,
    pedidoId: pedido.id,
    prensaId: prensa.id,
    maquinaFlexografiaId: flexo.id,
  };
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
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [{ quantidade: 1, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
    },
  };
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.apontamentoEtapa.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.prensa.deleteMany({ where: { graficaId } });
    await prisma.maquinaFlexografia.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("ApontamentoEtapa — achado B1/B2 (histórico de etapa + máquina)", () => {
  it(
    "abrirApontamentoInicialSeNecessario abre a etapa ARTE e é idempotente (2ª chamada não duplica)",
    async () => {
      const f = await criarFixturePedido("ARTE");

      await prisma.$transaction(async (tx) => {
        await abrirApontamentoInicialSeNecessario(tx, {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          origemConfirmacao: "APP",
        });
        // 2ª chamada na MESMA transação — simula o upsert de pedido rodando
        // de novo numa re-submissão (duplo clique/retry), ver comentário na
        // função.
        await abrirApontamentoInicialSeNecessario(tx, {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          origemConfirmacao: "APP",
        });
      });

      const apontamentos = await prisma.apontamentoEtapa.findMany({ where: { pedidoId: f.pedidoId } });
      expect(apontamentos).toHaveLength(1);
      expect(apontamentos[0].status).toBe("ARTE");
      expect(apontamentos[0].finalizadoEm).toBeNull();
      expect(apontamentos[0].origemConfirmacao).toBe("APP");
    },
    TIMEOUT_MS
  );

  it(
    "avancarStatusPedido fecha o apontamento da etapa anterior e abre o da seguinte, com a máquina informada",
    async () => {
      const f = await criarFixturePedido("ARTE");
      await prisma.apontamentoEtapa.create({
        data: { graficaId: f.graficaId, pedidoId: f.pedidoId, status: "ARTE", origemConfirmacao: "APP" },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "ARTE"), null, {
        origemConfirmacao: "APP",
        operadorId: f.usuarioId,
        selecaoMaquina: { ...SELECAO_MAQUINA_VAZIA, prensaId: f.prensaId },
      });
      expect(resultado.ok).toBe(true);

      const apontamentos = await prisma.apontamentoEtapa.findMany({
        where: { pedidoId: f.pedidoId },
        orderBy: { iniciadoEm: "asc" },
      });
      expect(apontamentos).toHaveLength(2);

      const [etapaArte, etapaClicheFaca] = apontamentos;
      expect(etapaArte.status).toBe("ARTE");
      expect(etapaArte.finalizadoEm).not.toBeNull();

      expect(etapaClicheFaca.status).toBe("CLICHE_FACA");
      expect(etapaClicheFaca.finalizadoEm).toBeNull();
      expect(etapaClicheFaca.prensaId).toBe(f.prensaId);
      expect(etapaClicheFaca.maquinaFlexografiaId).toBeNull();
      expect(etapaClicheFaca.operadorId).toBe(f.usuarioId);
      expect(etapaClicheFaca.origemConfirmacao).toBe("APP");
    },
    TIMEOUT_MS
  );

  it(
    "gera o apontamento também na transição CLICHE_FACA→PRODUCAO (branch de baixa de estoque)",
    async () => {
      const f = await criarFixturePedido("CLICHE_FACA");
      await prisma.apontamentoEtapa.create({
        data: { graficaId: f.graficaId, pedidoId: f.pedidoId, status: "CLICHE_FACA", origemConfirmacao: "APP" },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "CLICHE_FACA"), JSON.stringify([]), {
        origemConfirmacao: "APP",
        operadorId: null,
        selecaoMaquina: { ...SELECAO_MAQUINA_VAZIA, maquinaFlexografiaId: f.maquinaFlexografiaId },
      });
      expect(resultado.ok).toBe(true);

      const apontamentos = await prisma.apontamentoEtapa.findMany({
        where: { pedidoId: f.pedidoId },
        orderBy: { iniciadoEm: "asc" },
      });
      expect(apontamentos).toHaveLength(2);
      expect(apontamentos[0].finalizadoEm).not.toBeNull();
      expect(apontamentos[1].status).toBe("PRODUCAO");
      expect(apontamentos[1].maquinaFlexografiaId).toBe(f.maquinaFlexografiaId);
    },
    TIMEOUT_MS
  );

  it.each([
    ["APP" as const],
    ["LINK_PUBLICO" as const],
    ["QR_ETIQUETA" as const],
  ])(
    "grava origemConfirmacao=%s corretamente no apontamento aberto",
    async (origem) => {
      const f = await criarFixturePedido("ACABAMENTO");
      await prisma.apontamentoEtapa.create({
        data: { graficaId: f.graficaId, pedidoId: f.pedidoId, status: "ACABAMENTO", origemConfirmacao: "APP" },
      });

      const resultado = await avancarStatusPedido(pedidoParaAvanco(f, "ACABAMENTO"), null, {
        origemConfirmacao: origem,
        operadorId: null,
      });
      expect(resultado.ok).toBe(true);

      const aberto = await prisma.apontamentoEtapa.findFirst({
        where: { pedidoId: f.pedidoId, finalizadoEm: null },
      });
      expect(aberto?.status).toBe("CONFERENCIA");
      expect(aberto?.origemConfirmacao).toBe(origem);
      // LINK_PUBLICO/QR_ETIQUETA não coletam máquina (decisão de escopo) —
      // nenhum dos 5 campos vem preenchido nesses 2 canais.
      if (origem !== "APP") {
        expect(aberto?.prensaId).toBeNull();
        expect(aberto?.maquinaFlexografiaId).toBeNull();
      }
    },
    TIMEOUT_MS
  );

  it(
    "CAS impede duplo avanço (duplo clique) e não duplica o apontamento",
    async () => {
      const f = await criarFixturePedido("ARTE");
      await prisma.apontamentoEtapa.create({
        data: { graficaId: f.graficaId, pedidoId: f.pedidoId, status: "ARTE", origemConfirmacao: "APP" },
      });

      const pedido = pedidoParaAvanco(f, "ARTE");
      const primeira = await avancarStatusPedido(pedido, null, { origemConfirmacao: "APP", operadorId: null });
      expect(primeira.ok).toBe(true);

      // Mesmo objeto "stale" (ainda alegando status ARTE) — replica duas
      // abas/clique duplo. O CAS dentro de avancarStatusPedido já barra isso.
      const segunda = await avancarStatusPedido(pedido, null, { origemConfirmacao: "APP", operadorId: null });
      expect(segunda.ok).toBe(false);

      const apontamentos = await prisma.apontamentoEtapa.findMany({ where: { pedidoId: f.pedidoId } });
      // ARTE finalizado + CLICHE_FACA aberto — nunca um 3º apontamento pela
      // 2ª chamada, que o CAS já rejeitou antes de tocar em ApontamentoEtapa.
      expect(apontamentos).toHaveLength(2);
    },
    TIMEOUT_MS
  );
});

describe("validarSelecaoMaquinaOpcional / extrairEValidarSelecaoMaquina — no máximo 1 máquina", () => {
  it(
    "rejeita quando mais de uma máquina vem preenchida no FormData",
    async () => {
      const f = await criarFixturePedido("ARTE");
      const formData = new FormData();
      // Todos os 5 campos preenchidos explicitamente (mesmo vazios) — evita
      // a pegadinha de formData.get() de chave nunca .set() virar null em
      // vez de "" (documentada na tarefa).
      formData.set("prensaId", f.prensaId);
      formData.set("maquinaFlexografiaId", f.maquinaFlexografiaId);
      formData.set("equipamentoId", "");
      formData.set("impressoraDigitalId", "");
      formData.set("maquinaSetupPorPecaId", "");

      const resultado = await extrairEValidarSelecaoMaquina(formData, f.graficaId);
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "aceita 0 preenchidas (nenhuma máquina informada)",
    async () => {
      const f = await criarFixturePedido("ARTE");
      const formData = new FormData();
      formData.set("prensaId", "");
      formData.set("maquinaFlexografiaId", "");
      formData.set("equipamentoId", "");
      formData.set("impressoraDigitalId", "");
      formData.set("maquinaSetupPorPecaId", "");

      const resultado = await extrairEValidarSelecaoMaquina(formData, f.graficaId);
      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        expect(resultado.selecao).toEqual(SELECAO_MAQUINA_VAZIA);
      }
    },
    TIMEOUT_MS
  );

  it(
    "aceita exatamente 1 preenchida e confere que a máquina pertence à gráfica",
    async () => {
      const f = await criarFixturePedido("ARTE");
      const formData = new FormData();
      formData.set("prensaId", f.prensaId);
      formData.set("maquinaFlexografiaId", "");
      formData.set("equipamentoId", "");
      formData.set("impressoraDigitalId", "");
      formData.set("maquinaSetupPorPecaId", "");

      const resultado = await extrairEValidarSelecaoMaquina(formData, f.graficaId);
      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        expect(resultado.selecao.prensaId).toBe(f.prensaId);
      }
    },
    TIMEOUT_MS
  );

  it(
    "rejeita uma prensa de OUTRA gráfica (isolamento de tenant)",
    async () => {
      const f1 = await criarFixturePedido("ARTE");
      const f2 = await criarFixturePedido("ARTE");
      const formData = new FormData();
      formData.set("prensaId", f1.prensaId);
      formData.set("maquinaFlexografiaId", "");
      formData.set("equipamentoId", "");
      formData.set("impressoraDigitalId", "");
      formData.set("maquinaSetupPorPecaId", "");

      // Pede validação usando a gráfica de f2 — a prensa é de f1.
      const resultado = await extrairEValidarSelecaoMaquina(formData, f2.graficaId);
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );
});

describe("sugerirMaquinaPedido — sugestão pré-preenchida a partir dos itens do pedido", () => {
  it("sugere a máquina quando um único item do pedido tem máquina configurada", () => {
    const sugestao = sugerirMaquinaPedido([
      { itemGrafica: { prensaId: "prensa-1", maquinaFlexografiaId: null, impressoraDigitalId: null, maquinaSetupPorPecaId: null } },
    ]);
    expect(sugestao).toEqual({ campo: "prensaId", id: "prensa-1" });
  });

  it("não sugere nada quando dois itens do pedido usam máquinas diferentes (ambíguo)", () => {
    const sugestao = sugerirMaquinaPedido([
      { itemGrafica: { prensaId: "prensa-1", maquinaFlexografiaId: null, impressoraDigitalId: null, maquinaSetupPorPecaId: null } },
      { itemGrafica: { prensaId: "prensa-2", maquinaFlexografiaId: null, impressoraDigitalId: null, maquinaSetupPorPecaId: null } },
    ]);
    expect(sugestao).toBeNull();
  });

  it("continua sugerindo quando os itens repetem EXATAMENTE a mesma máquina", () => {
    const sugestao = sugerirMaquinaPedido([
      { itemGrafica: { prensaId: "prensa-1", maquinaFlexografiaId: null, impressoraDigitalId: null, maquinaSetupPorPecaId: null } },
      { itemGrafica: { prensaId: "prensa-1", maquinaFlexografiaId: null, impressoraDigitalId: null, maquinaSetupPorPecaId: null } },
    ]);
    expect(sugestao).toEqual({ campo: "prensaId", id: "prensa-1" });
  });

  it("não sugere nada quando nenhum item tem máquina configurada", () => {
    const sugestao = sugerirMaquinaPedido([
      { itemGrafica: { prensaId: null, maquinaFlexografiaId: null, impressoraDigitalId: null, maquinaSetupPorPecaId: null } },
    ]);
    expect(sugestao).toBeNull();
  });
});
