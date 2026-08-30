import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularQuantidadeEstoque, avisoMultiploCompra } from "@/lib/unidade-compra";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/compras/origem-solicitacao-compra.test.ts) — cobre
// o achado A6 da auditoria de abrangência (Parte 3/Compras, 2026-08-30):
// SolicitacaoCompra.quantidade sempre foi digitada direto na unidade de
// ESTOQUE, sem forma de registrar "comprei 3 fardos, 1 fardo = 50kg" — o
// comprador convertia de cabeça e o preço negociado (R$/fardo) nunca era
// distinguido do preço por unidade de estoque.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260830150000_unidade_compra/migration.sql tiver sido
// aplicada no banco (enum UnidadeCompra e as colunas novas em itens_grafica/
// solicitacoes_compra ainda não existem até lá).
//
// Mesmos dublês de origem-solicitacao-compra.test.ts: redirect() mockado
// (criarSolicitacaoCompra navega via redirect() no caminho de SUCESSO, que
// fora de uma requisição Next.js de verdade lança NEXT_REDIRECT) e
// exigirUsuarioAutenticado/exigirEmailVerificado/exigirAssinaturaAtiva
// mockados (dependem de cookies()/headers() de uma requisição de verdade).
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
import { criarSolicitacaoCompra } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  itemGraficaId: string; // matéria-prima, sem padrão de compra configurado
  itemGraficaComPadraoId: string; // matéria-prima com unidadeCompraPadrao configurado
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Unidade Compra ${s}`, slug: `teste-unidade-compra-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-unidade-compra-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });

  const catalogoSemPadrao = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Bobina ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoSemPadrao.id, estoqueAtual: 0 },
  });

  const catalogoComPadrao = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Chapa offset ${s}` },
  });
  const itemGraficaComPadrao = await prisma.itemGrafica.create({
    data: {
      graficaId: grafica.id,
      itemCatalogoId: catalogoComPadrao.id,
      estoqueAtual: 0,
      unidadeCompraPadrao: "FARDO",
      fatorConversaoCompraPadrao: 50, // 1 fardo = 50 unidades de estoque
      multiploCompra: 2, // só vende em múltiplos de 2 fardos
      loteMinimoCompra: 2,
    },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    itemGraficaId: itemGrafica.id,
    itemGraficaComPadraoId: itemGraficaComPadrao.id,
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.solicitacaoCompra.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
  redirectMock.mockClear();
}, TIMEOUT_MS);

async function autenticarComo(usuarioId: string) {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })) as never
  );
}

describe("calcularQuantidadeEstoque / avisoMultiploCompra (funções puras)", () => {
  it("quantidadeCompra × fatorConversaoCompra = quantidade de estoque", () => {
    expect(calcularQuantidadeEstoque(3, 50)).toBe(150);
    expect(calcularQuantidadeEstoque(1.5, 10)).toBe(15);
  });

  it("sem aviso quando a quantidade é múltiplo exato do lote", () => {
    expect(avisoMultiploCompra(4, 2, "fardo")).toBeNull();
  });

  it("sem aviso quando não há múltiplo configurado (null/undefined/zero)", () => {
    expect(avisoMultiploCompra(3, null, "fardo")).toBeNull();
    expect(avisoMultiploCompra(3, undefined, "fardo")).toBeNull();
    expect(avisoMultiploCompra(3, 0, "fardo")).toBeNull();
  });

  it("avisa (mensagem, não erro) quando a quantidade não é múltiplo do lote", () => {
    const aviso = avisoMultiploCompra(3, 2, "fardo");
    expect(aviso).not.toBeNull();
    expect(aviso).toMatch(/múltiplo/i);
  });
});

describe("criarSolicitacaoCompra — unidade de compra (achado A6 da auditoria de abrangência)", () => {
  it(
    "sem unidadeCompra: quantidade é usada direto, sem conversão — comportamento de hoje 100% preservado",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "120");

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(Number(solicitacao.quantidade)).toBe(120);
      expect(solicitacao.unidadeCompra).toBeNull();
      expect(solicitacao.unidadeCompraOutro).toBeNull();
      expect(solicitacao.quantidadeCompra).toBeNull();
      expect(solicitacao.fatorConversaoCompra).toBeNull();
      expect(solicitacao.precoUnitarioCompra).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "com unidadeCompra: quantidade (estoque) é DERIVADA de quantidadeCompra × fatorConversaoCompra",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaComPadraoId);
      fd.set("unidadeCompra", "FARDO");
      fd.set("quantidadeCompra", "3");
      fd.set("fatorConversaoCompra", "50");
      fd.set("precoUnitarioCompra", "260"); // R$/fardo — diferente de precoCompra (R$/unidade de estoque)
      // quantidade (unidade de estoque) de propósito ausente — deve ser
      // ignorada/recalculada, nunca confiar no que o client mandaria.
      fd.set("quantidade", "999999");

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(Number(solicitacao.quantidade)).toBe(150); // 3 × 50, não 999999
      expect(solicitacao.unidadeCompra).toBe("FARDO");
      expect(Number(solicitacao.quantidadeCompra)).toBe(3);
      expect(Number(solicitacao.fatorConversaoCompra)).toBe(50);
      expect(Number(solicitacao.precoUnitarioCompra)).toBe(260);
    },
    TIMEOUT_MS
  );

  it(
    "unidadeCompra=OUTRO grava o texto livre; qualquer outra unidade ignora o campo texto",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaComPadraoId);
      fd.set("unidadeCompra", "OUTRO");
      fd.set("unidadeCompraOutro", "Contêiner");
      fd.set("quantidadeCompra", "1");
      fd.set("fatorConversaoCompra", "1000");

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(solicitacao.unidadeCompra).toBe("OUTRO");
      expect(solicitacao.unidadeCompraOutro).toBe("Contêiner");
    },
    TIMEOUT_MS
  );

  it(
    "unidadeCompra sem quantidadeCompra/fatorConversaoCompra é rejeitado, nada é criado",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaComPadraoId);
      fd.set("unidadeCompra", "FARDO");
      // quantidadeCompra/fatorConversaoCompra de propósito ausentes

      const resultado = await criarSolicitacaoCompra(null, fd);

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/fator de conversão/i);
      expect(redirectMock).not.toHaveBeenCalled();

      const criadas = await prisma.solicitacaoCompra.findMany({ where: { graficaId: f.graficaId } });
      expect(criadas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "quantidade não múltiplo de ItemGrafica.multiploCompra NUNCA bloqueia a criação — só aviso client-side",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      // itemGraficaComPadraoId tem multiploCompra=2 — 3 fardos não é múltiplo,
      // mas o servidor nem lê multiploCompra pra criar: é só configuração de
      // aviso (ver avisoMultiploCompra), nunca validação bloqueante.
      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaComPadraoId);
      fd.set("unidadeCompra", "FARDO");
      fd.set("quantidadeCompra", "3");
      fd.set("fatorConversaoCompra", "50");

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(Number(solicitacao.quantidadeCompra)).toBe(3);

      // Confirma que o helper de aviso REALMENTE acusaria a divergência —
      // é ele quem a UI usa pra avisar, não uma validação de servidor.
      const itemGrafica = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaComPadraoId } });
      const aviso = avisoMultiploCompra(3, Number(itemGrafica.multiploCompra), "fardo");
      expect(aviso).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "ItemGrafica.unidadeCompraPadrao/fatorConversaoCompraPadrao ficam disponíveis pra pré-preenchimento",
    async () => {
      const f = await criarFixture();
      const itemGrafica = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaComPadraoId } });
      expect(itemGrafica.unidadeCompraPadrao).toBe("FARDO");
      expect(Number(itemGrafica.fatorConversaoCompraPadrao)).toBe(50);
      expect(Number(itemGrafica.loteMinimoCompra)).toBe(2);

      // Simula o formulário pré-preenchido com esses padrões (mesmo valor que
      // NovaSolicitacaoForm usaria) — deve funcionar exatamente como se o
      // comprador tivesse digitado os mesmos números na mão.
      await autenticarComo(f.usuarioDonoId);
      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaComPadraoId);
      fd.set("unidadeCompra", itemGrafica.unidadeCompraPadrao!);
      fd.set("quantidadeCompra", "4");
      fd.set("fatorConversaoCompra", itemGrafica.fatorConversaoCompraPadrao!.toString());

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);
      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(Number(solicitacao.quantidade)).toBe(200); // 4 × 50
    },
    TIMEOUT_MS
  );
});
