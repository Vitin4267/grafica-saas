import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.desconto.test.ts) — cobre o
// achado F7 da Parte 7 da auditoria de abrangência: OrcamentoItem ganhou
// profundidadeCm/espessuraMm (item de orçamento com 3 dimensões — caixa/
// embalagem, acrílico, livro — e espessura de chapa do item VENDIDO, corte a
// laser/router). Cobre criarOrcamento (fluxo de carrinho via itensJson,
// itemEntradaSchema em src/lib/orcamento-item-entrada.ts).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// redirect() é mockado (não next/navigation inteiro — só a função) porque
// criarOrcamento sempre redireciona no sucesso, e redirect() fora de uma
// requisição Next.js de verdade lança NEXT_REDIRECT — mesmo padrão de
// src/app/orcamento/[id]/actions.duplicar.test.ts.
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
    data: { nome: `Teste Dimensoes Item ${s}`, slug: `teste-dimensoes-item-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-dimensoes-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  // Produto SIMPLES (sem exigir largura/altura pro motor) — o suficiente pra
  // exercitar profundidadeCm/espessuraMm, que nenhum motor de preço usa.
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Embalagem", nome: `Caixa Teste ${s}` },
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
    ...overrides,
  };
}

describe("criarOrcamento — profundidadeCm/espessuraMm (achado F7)", () => {
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
    "grava profundidadeCm (convertida pra cm) e espessuraMm (direto, sem conversão) quando preenchidos",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const itensJson = JSON.stringify([
        itemJson(
          {
            // Digitado em MM — profundidadeCm gravado deve ser a conversão
            // pra cm (200mm = 20cm), igual ao que largura/altura já fazem.
            profundidade: 200,
            unidadeDimensao: "MM",
            // espessuraMm nunca passa por conversão de unidade — grava 3
            // literal, mesmo o item tendo sido digitado em MM acima.
            espessuraMm: 3,
          },
          fixture.itemGraficaId
        ),
      ]);

      await expect(
        criarOrcamento(null, formDataDe({ clienteId: fixture.clienteId, itensJson }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);
      expect(redirectMock).toHaveBeenCalledTimes(1);

      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamento: { graficaId: fixture.graficaId } },
      });
      expect(item.profundidadeCm?.toString()).toBe("20");
      expect(item.espessuraMm?.toString()).toBe("3");
    },
    TIMEOUT_MS
  );

  it(
    "sem preencher profundidade/espessura, o item continua nascendo normalmente (regressão zero)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const itensJson = JSON.stringify([itemJson({ quantidade: 5 }, fixture.itemGraficaId)]);

      await expect(
        criarOrcamento(null, formDataDe({ clienteId: fixture.clienteId, itensJson }))
      ).rejects.toThrow(/^NEXT_REDIRECT:/);
      expect(redirectMock).toHaveBeenCalledTimes(1);

      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamento: { graficaId: fixture.graficaId } },
      });
      expect(item.profundidadeCm).toBeNull();
      expect(item.espessuraMm).toBeNull();
      // Preço não regride: SIMPLES sem dimensão continua precoVenda × qtd.
      expect(Number(item.precoTotal)).toBe(50);
    },
    TIMEOUT_MS
  );
});
