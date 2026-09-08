import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/actions.dimensoes-item.test.ts) — cobre
// as 2 melhorias pequenas pedidas pelo dono depois de comparar o GrafPro com
// um "Pedido Interno" real em papel da Assus Graphics (cliente-piloto):
//
// 1. Orcamento.numeroPedidoCliente (cabeçalho) — número que o CLIENTE usa
//    pra rastrear a própria compra, independente do número do GrafPro.
// 2. OrcamentoItem.tipoRepeticao (por item) — checkbox "Modelo Novo /
//    Repetição s/ alteração / Repetição c/ alteração" do formulário de
//    papel, reaproveitando o enum TipoPedidoOrcamento já usado no
//    cabeçalho (Orcamento.tipoPedido) — ver comentário completo no schema.
//
// Este arquivo cobre criarOrcamento (fluxo de carrinho via itensJson,
// itemEntradaSchema em src/lib/orcamento-item-entrada.ts) — os dois campos
// são puramente informativos, nenhum motor de preço os lê.
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
  itemGraficaId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Pedido Cliente ${s}`, slug: `teste-pedido-cliente-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-pedido-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  // Produto SIMPLES — o suficiente pra exercitar os 2 campos novos, que
  // nenhum motor de preço lê.
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Rótulo", nome: `Rótulo Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 10 },
  });

  return { graficaId: grafica.id, usuarioId: usuario.id, clienteId: cliente.id, itemGraficaId: itemGrafica.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
}

// Item de carrinho mínimo pra itemEntradaSchema — todo campo que o schema
// exige (mesmo nullable) precisa estar presente, senão o zod rejeita o JSON
// inteiro (ver itemEntradaSchema em src/lib/orcamento-item-entrada.ts).
function itemJson(overrides: Record<string, unknown>, itemGraficaId: string) {
  return {
    itemGraficaId,
    quantidade: 5,
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
    ...overrides,
  };
}

describe("criarOrcamento — numeroPedidoCliente (cabeçalho) e tipoRepeticao (item)", () => {
  const graficaIdsParaLimpar: string[] = [];

  afterEach(async () => {
    for (const graficaId of graficaIdsParaLimpar) {
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
    redirectMock.mockClear();
  }, TIMEOUT_MS);

  it(
    "grava numeroPedidoCliente (cabeçalho) e tipoRepeticao (item) quando preenchidos",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const itensJson = JSON.stringify([
        itemJson({ tipoRepeticao: "REPETICAO_SEM_ALTERACAO" }, fixture.itemGraficaId),
      ]);

      await expect(
        criarOrcamento(
          null,
          formDataDe({
            clienteId: fixture.clienteId,
            itensJson,
            numeroPedidoCliente: "MLAGO/001",
          })
        )
      ).rejects.toThrow(/^NEXT_REDIRECT:/);
      expect(redirectMock).toHaveBeenCalledTimes(1);

      const orcamento = await prisma.orcamento.findFirstOrThrow({
        where: { graficaId: fixture.graficaId },
        include: { itens: true },
      });
      expect(orcamento.numeroPedidoCliente).toBe("MLAGO/001");
      expect(orcamento.itens[0].tipoRepeticao).toBe("REPETICAO_SEM_ALTERACAO");
    },
    TIMEOUT_MS
  );

  it(
    "sem preencher numeroPedidoCliente/tipoRepeticao, o orçamento continua nascendo normalmente (regressão zero)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const itensJson = JSON.stringify([itemJson({}, fixture.itemGraficaId)]);

      await expect(
        criarOrcamento(null, formDataDe({ clienteId: fixture.clienteId, itensJson }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);
      expect(redirectMock).toHaveBeenCalledTimes(1);

      const orcamento = await prisma.orcamento.findFirstOrThrow({
        where: { graficaId: fixture.graficaId },
        include: { itens: true },
      });
      expect(orcamento.numeroPedidoCliente).toBeNull();
      expect(orcamento.itens[0].tipoRepeticao).toBeNull();
      // Preço não regride: SIMPLES sem dimensão continua precoVenda × qtd.
      expect(Number(orcamento.itens[0].precoTotal)).toBe(50);
    },
    TIMEOUT_MS
  );
});
