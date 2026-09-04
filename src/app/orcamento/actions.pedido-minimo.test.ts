import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/actions.dimensoes-item.test.ts) — cobre
// o achado N3 da auditoria de abrangência: pedidoMinimo era aplicado por
// ITEM dentro de comporPreco, então um orçamento com vários itens abaixo do
// mínimo cada um cobrava N× o mínimo, em vez de aplicar o piso UMA VEZ sobre
// o total do orçamento. Cobre criarOrcamento (fluxo de carrinho via
// itensJson) ponta a ponta, incluindo a gravação de Orcamento.total.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
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
import { criarOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  clienteId: string;
  // 3 produtos SIMPLES (sem exigir largura/altura) com preços R$12, R$9 e
  // R$4 — o mesmo cenário do achado N3 (soma R$25, abaixo do mínimo).
  itemCartoes: string;
  itemPanfletos: string;
  itemCracha: string;
};

async function criarFixture(pedidoMinimo: number): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Pedido Minimo ${s}`, slug: `teste-pedido-minimo-${s}` },
  });
  await prisma.parametrosGrafica.create({
    data: { graficaId: grafica.id, pedidoMinimo, incrementoArredondamento: 0.01 },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-pedido-minimo-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });

  async function criarProdutoSimples(nome: string, preco: number) {
    const catalogo = await prisma.itemCatalogo.create({
      data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Diversos", nome: `${nome} ${s}` },
    });
    const itemGrafica = await prisma.itemGrafica.create({
      data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: preco },
    });
    return itemGrafica.id;
  }

  const itemCartoes = await criarProdutoSimples("Cartões", 12);
  const itemPanfletos = await criarProdutoSimples("Panfletos", 9);
  const itemCracha = await criarProdutoSimples("Crachá", 4);

  return { graficaId: grafica.id, usuarioId: usuario.id, clienteId: cliente.id, itemCartoes, itemPanfletos, itemCracha };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
}

function itemJson(itemGraficaId: string) {
  return {
    itemGraficaId,
    quantidade: 1,
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
    gramaturaGm2: null,
    custoAquisicaoUnitario: null,
    materialFornecidoPeloCliente: false,
  };
}

describe("criarOrcamento — piso de pedido aplicado uma vez sobre o total (achado N3)", () => {
  const graficaIdsParaLimpar: string[] = [];

  afterEach(async () => {
    for (const graficaId of graficaIdsParaLimpar) {
      await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
      await prisma.orcamento.deleteMany({ where: { graficaId } });
      await prisma.itemGrafica.deleteMany({ where: { graficaId } });
      await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
      await prisma.cliente.deleteMany({ where: { graficaId } });
      await prisma.usuario.deleteMany({ where: { graficaId } });
      await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
      await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
    }
    graficaIdsParaLimpar.length = 0;
    vi.mocked(exigirUsuarioAutenticado).mockReset();
    redirectMock.mockClear();
  }, TIMEOUT_MS);

  it(
    "3 itens somando R$25 com pedidoMinimo=30 -> total final R$30 (não R$25 nem 3×30=90)",
    async () => {
      const fixture = await criarFixture(30);
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const itensJson = JSON.stringify([
        itemJson(fixture.itemCartoes),
        itemJson(fixture.itemPanfletos),
        itemJson(fixture.itemCracha),
      ]);

      await expect(
        criarOrcamento(null, formDataDe({ clienteId: fixture.clienteId, itensJson }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);
      expect(redirectMock).toHaveBeenCalledTimes(1);

      const orcamento = await prisma.orcamento.findFirstOrThrow({
        where: { graficaId: fixture.graficaId },
      });
      // Cada linha individual continua com o preço calculado (sem piso por
      // item) — a prova de que o achado N3 não regrediu pro comportamento
      // antigo por item.
      const itens = await prisma.orcamentoItem.findMany({ where: { orcamentoId: orcamento.id } });
      const precos = itens.map((i) => Number(i.precoTotal)).sort((a, b) => a - b);
      expect(precos).toEqual([4, 9, 12]);
      expect(precos.reduce((a, b) => a + b, 0)).toBe(25);

      // O TOTAL do orçamento é o que leva o piso — 30, não 25 nem 90.
      expect(Number(orcamento.total)).toBe(30);
    },
    TIMEOUT_MS
  );

  it(
    "soma dos itens acima do mínimo: total é a soma normal, piso não interfere",
    async () => {
      const fixture = await criarFixture(10);
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const itensJson = JSON.stringify([
        itemJson(fixture.itemCartoes),
        itemJson(fixture.itemPanfletos),
        itemJson(fixture.itemCracha),
      ]);

      await expect(
        criarOrcamento(null, formDataDe({ clienteId: fixture.clienteId, itensJson }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);

      const orcamento = await prisma.orcamento.findFirstOrThrow({
        where: { graficaId: fixture.graficaId },
      });
      expect(Number(orcamento.total)).toBe(25);
    },
    TIMEOUT_MS
  );

  it(
    "pedidoMinimo=0 (padrão, gráfica sem piso configurado): total nunca é alterado (regressão zero)",
    async () => {
      const fixture = await criarFixture(0);
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const itensJson = JSON.stringify([itemJson(fixture.itemCracha)]);

      await expect(
        criarOrcamento(null, formDataDe({ clienteId: fixture.clienteId, itensJson }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);

      const orcamento = await prisma.orcamento.findFirstOrThrow({
        where: { graficaId: fixture.graficaId },
      });
      expect(Number(orcamento.total)).toBe(4);
    },
    TIMEOUT_MS
  );
});
