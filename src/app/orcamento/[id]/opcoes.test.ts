import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.desconto.test.ts) — cobre a
// feature de múltiplas opções no mesmo orçamento (ver model OrcamentoOpcao
// no schema.prisma e src/lib/orcamento-opcoes.ts): criar/remover uma opção
// alternativa, e o "torneio" de promoção na aprovação (autenticada e pelo
// link público) — a opção escolhida vira a nova base, as outras somem.
//
// after() (next/server) e headers() (next/headers) lançam "called outside a
// request scope" fora de uma requisição Next.js de verdade — mesmo motivo de
// src/lib/alerta-prazo-email.test.ts mockar next/server. next/headers só é
// tocado pelo caminho PÚBLICO (obterIpRequisicao pro rate limit) — mockado
// com um Headers vazio, suficiente pra "desconhecido" no rate limit e pra
// resolverOrigemPublica nem chegar a lê-lo (APP_URL já está setada no .env
// de teste, curto-circuita antes do fallback por header).
vi.mock("next/server", () => ({ after: (tarefa: () => void) => tarefa() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

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

// dispararEventoEmail de verdade tentaria bater em EMAIL_WEBHOOK_URL (ausente
// no ambiente de teste) — substituído por um spy, mesmo padrão de
// alerta-prazo-email.test.ts.
vi.mock("@/lib/email/webhook-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/webhook-email")>();
  return { ...real, dispararEventoEmail: vi.fn(async () => true) };
});

import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { adicionarItemOrcamento, atualizarStatusOrcamento } from "./actions";
import { adicionarOpcaoOrcamento, removerOpcaoOrcamento } from "./opcoes.actions";
import { responderOrcamentoPublico } from "@/app/o/[token]/actions";
import {
  MAX_OPCOES_ALTERNATIVAS,
  resolverOpcoesNaAprovacao,
  descartarOpcoesAlternativas,
} from "@/lib/orcamento-opcoes";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  itemGraficaId: string;
  orcamentoId: string;
  precoVenda: number;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Opções ${s}`, slug: `teste-opcoes-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-opcoes-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });

  const precoVenda = 100;
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda },
  });

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "RASCUNHO", total: 0 },
  });

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    itemGraficaId: itemGrafica.id,
    orcamentoId: orcamento.id,
    precoVenda,
  };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
}

// Item de carrinho mínimo (SIMPLES, sem dimensão) — mesmo shape de
// itemEntradaSchema (src/lib/orcamento-item-entrada.ts).
function itemCarrinhoJson(itemGraficaId: string, quantidade: number): string {
  return JSON.stringify([
    {
      itemGraficaId,
      quantidade,
      largura: null,
      altura: null,
      profundidade: null,
      espessuraMm: null,
      unidadeDimensao: "CM",
      corFrente: null,
      corVerso: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      cores: null,
      acabamento: null,
      descricaoLivre: null,
      acabamentoIds: [],
      etiqueta: null,
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
    },
  ]);
}

async function adicionarItemBaseFixture(fixture: Fixture, quantidade: number): Promise<void> {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await usuarioParaMock(fixture.usuarioDonoId)) as never
  );
  const resultado = await adicionarItemOrcamento(
    null,
    formDataDe({
      orcamentoId: fixture.orcamentoId,
      itemGraficaId: fixture.itemGraficaId,
      quantidade: String(quantidade),
      unidadeDimensao: "CM",
    })
  );
  expect(resultado.ok).toBe(true);
}

async function adicionarOpcaoFixture(
  fixture: Fixture,
  nome: string,
  quantidade: number
): Promise<string> {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await usuarioParaMock(fixture.usuarioDonoId)) as never
  );
  const fd = formDataDe({ orcamentoId: fixture.orcamentoId, nome });
  fd.set("itensJson", itemCarrinhoJson(fixture.itemGraficaId, quantidade));
  const resultado = await adicionarOpcaoOrcamento(null, fd);
  expect(resultado.ok).toBe(true);
  const opcao = await prisma.orcamentoOpcao.findFirstOrThrow({
    where: { orcamentoId: fixture.orcamentoId, nome },
  });
  return opcao.id;
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.pedidoCustoPrevisto.deleteMany({ where: { graficaId } });
    await prisma.comissao.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.assinaturaGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("resolverOpcoesNaAprovacao / descartarOpcoesAlternativas (núcleo, sem passar pelas actions)", () => {
  it(
    "sem nenhuma OrcamentoOpcao: no-op, devolve o total já gravado e nome null",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5); // total = 500

      const resolucao = await prisma.$transaction((tx) =>
        resolverOpcoesNaAprovacao(tx, { orcamentoId: fixture.orcamentoId, opcaoEscolhidaId: null })
      );

      expect(resolucao.opcaoEscolhidaNome).toBeNull();
      expect(Number(resolucao.total)).toBe(500);
    },
    TIMEOUT_MS
  );

  it(
    "opção-base vence entre alternativas: alternativas descartadas, base intocada",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5); // base = 500
      await adicionarOpcaoFixture(fixture, "Opção B", 9); // alt = 900

      const resolucao = await prisma.$transaction((tx) =>
        resolverOpcoesNaAprovacao(tx, { orcamentoId: fixture.orcamentoId, opcaoEscolhidaId: null })
      );

      expect(resolucao.opcaoEscolhidaNome).toBe("Opção A");
      expect(Number(resolucao.total)).toBe(500);

      const opcoesRestantes = await prisma.orcamentoOpcao.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(opcoesRestantes).toBe(0);
      const itensBase = await prisma.orcamentoItem.findMany({
        where: { orcamentoId: fixture.orcamentoId, opcaoId: null },
      });
      expect(itensBase).toHaveLength(1);
      expect(itensBase[0].quantidade).toBe(5);
    },
    TIMEOUT_MS
  );

  it(
    "alternativa vence: base perdedora descartada, itens da vencedora promovidos a opcaoId=null",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5); // base = 500
      const opcaoBId = await adicionarOpcaoFixture(fixture, "Opção B", 9); // alt = 900

      const resolucao = await prisma.$transaction((tx) =>
        resolverOpcoesNaAprovacao(tx, { orcamentoId: fixture.orcamentoId, opcaoEscolhidaId: opcaoBId })
      );

      expect(resolucao.opcaoEscolhidaNome).toBe("Opção B");
      expect(Number(resolucao.total)).toBe(900);

      const opcoesRestantes = await prisma.orcamentoOpcao.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(opcoesRestantes).toBe(0);
      const itens = await prisma.orcamentoItem.findMany({ where: { orcamentoId: fixture.orcamentoId } });
      // Só sobrou UM item (o da opção B, promovido) — o da base foi apagado.
      expect(itens).toHaveLength(1);
      expect(itens[0].opcaoId).toBeNull();
      expect(itens[0].quantidade).toBe(9);
    },
    TIMEOUT_MS
  );

  it(
    "descartarOpcoesAlternativas remove as alternativas e não toca na base",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5);
      await adicionarOpcaoFixture(fixture, "Opção B", 9);

      await prisma.$transaction((tx) => descartarOpcoesAlternativas(tx, fixture.orcamentoId));

      const opcoesRestantes = await prisma.orcamentoOpcao.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(opcoesRestantes).toBe(0);
      const itensBase = await prisma.orcamentoItem.findMany({
        where: { orcamentoId: fixture.orcamentoId, opcaoId: null },
      });
      expect(itensBase).toHaveLength(1);
    },
    TIMEOUT_MS
  );
});

describe("adicionarOpcaoOrcamento / removerOpcaoOrcamento", () => {
  it(
    "cria a opção com o total recalculado no servidor (nunca confia no carrinho do client)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5);

      const opcaoId = await adicionarOpcaoFixture(fixture, "Pacote Premium", 12);
      const opcao = await prisma.orcamentoOpcao.findUniqueOrThrow({ where: { id: opcaoId } });
      expect(Number(opcao.total)).toBe(12 * fixture.precoVenda);
    },
    TIMEOUT_MS
  );

  it(
    `respeita o teto de ${MAX_OPCOES_ALTERNATIVAS} opções alternativas`,
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5);

      for (let i = 0; i < MAX_OPCOES_ALTERNATIVAS; i++) {
        await adicionarOpcaoFixture(fixture, `Opção ${i}`, 3);
      }

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const fd = formDataDe({ orcamentoId: fixture.orcamentoId, nome: "Opção extra" });
      fd.set("itensJson", itemCarrinhoJson(fixture.itemGraficaId, 3));
      const resultado = await adicionarOpcaoOrcamento(null, fd);
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "só permite adicionar/remover opção enquanto o orçamento está em rascunho",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5);
      await prisma.orcamento.update({ where: { id: fixture.orcamentoId }, data: { status: "ENVIADO" } });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const fd = formDataDe({ orcamentoId: fixture.orcamentoId, nome: "Opção B" });
      fd.set("itensJson", itemCarrinhoJson(fixture.itemGraficaId, 3));
      const resultado = await adicionarOpcaoOrcamento(null, fd);
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "remove a opção (e só ela) sem afetar a opção-base",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5);
      const opcaoId = await adicionarOpcaoFixture(fixture, "Opção B", 9);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const resultado = await removerOpcaoOrcamento(null, formDataDe({ opcaoId }));
      expect(resultado.ok).toBe(true);

      const opcoesRestantes = await prisma.orcamentoOpcao.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(opcoesRestantes).toBe(0);
      const itensBase = await prisma.orcamentoItem.findMany({
        where: { orcamentoId: fixture.orcamentoId, opcaoId: null },
      });
      expect(itensBase).toHaveLength(1);
    },
    TIMEOUT_MS
  );
});

describe("atualizarStatusOrcamento (autenticada) com opções alternativas", () => {
  it(
    "aprovar escolhendo a alternativa promove o total/itens dela e cria o Pedido com esse total",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5); // base = 500
      const opcaoBId = await adicionarOpcaoFixture(fixture, "Opção B", 8); // alt = 800

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const envio = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, novoStatus: "ENVIADO" })
      );
      expect(envio.ok).toBe(true);

      const aprovacao = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, novoStatus: "APROVADO", opcaoId: opcaoBId })
      );
      expect(aprovacao.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(Number(orcamento.total)).toBe(800);
      expect(orcamento.opcaoEscolhidaNome).toBe("Opção B");

      const opcoesRestantes = await prisma.orcamentoOpcao.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(opcoesRestantes).toBe(0);

      const pedido = await prisma.pedido.findUniqueOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(Number(pedido.valorNegociadoTotal)).toBe(800);
    },
    TIMEOUT_MS
  );

  it(
    "rejeitar descarta as alternativas e preserva a opção-base",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await adicionarItemBaseFixture(fixture, 5); // base = 500
      await adicionarOpcaoFixture(fixture, "Opção B", 8);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, novoStatus: "ENVIADO" })
      );
      const rejeicao = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: fixture.orcamentoId, novoStatus: "REJEITADO" })
      );
      expect(rejeicao.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.status).toBe("REJEITADO");
      expect(Number(orcamento.total)).toBe(500); // base nunca é tocada na rejeição

      const opcoesRestantes = await prisma.orcamentoOpcao.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(opcoesRestantes).toBe(0);
    },
    TIMEOUT_MS
  );
});

describe("responderOrcamentoPublico (link público) com opções alternativas", () => {
  it(
    "cliente aprova a alternativa pelo link público — mesma promoção da action autenticada",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      await prisma.assinaturaGrafica.create({
        data: { graficaId: fixture.graficaId, status: "ATIVA" },
      });
      await adicionarItemBaseFixture(fixture, 5); // base = 500
      const opcaoBId = await adicionarOpcaoFixture(fixture, "Opção B", 8); // alt = 800

      const token = `token-teste-${sufixo()}`;
      await prisma.orcamento.update({
        where: { id: fixture.orcamentoId },
        data: {
          status: "ENVIADO",
          linkPublicoToken: token,
          enviadoEm: new Date(),
          validoAteEm: new Date(Date.now() + 86_400_000),
        },
      });

      const resultado = await responderOrcamentoPublico(
        null,
        formDataDe({
          token,
          decisao: "APROVADO",
          nome: "Cliente Teste",
          opcaoId: opcaoBId,
        })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(orcamento.status).toBe("APROVADO");
      expect(Number(orcamento.total)).toBe(800);
      expect(orcamento.opcaoEscolhidaNome).toBe("Opção B");

      const opcoesRestantes = await prisma.orcamentoOpcao.count({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(opcoesRestantes).toBe(0);

      const pedido = await prisma.pedido.findUniqueOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(Number(pedido.valorNegociadoTotal)).toBe(800);
    },
    TIMEOUT_MS
  );
});
