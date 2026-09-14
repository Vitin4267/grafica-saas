import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de dtf-modelo-calculo.test.ts) — cobre o achado A1 da
// auditoria do motor de preço (2026-09-13): antes desta action existir,
// NENHUMA tela do sistema conseguia gravar um FormatoFolha numa
// MATERIA_PRIMA, e todo orçamento DIGITAL morria em MATERIAL_SEM_FOLHA
// (ver src/lib/pricing/carregar.ts, contexto.digital.folhas). Este teste
// prova que o caminho real (UI → Server Action → banco) agora produz
// exatamente o estado que src/app/orcamento/[id]/actions/itens.precificacao-digital.test.ts
// já testava só via Prisma direto (estado antes inalcançável pelo app).

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
import { salvarFormatosFolhaPapel } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  papelId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Formatos Papel ${s}`, slug: `teste-formatos-papel-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-formatos-papel-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      emailVerificadoEm: new Date(),
    },
  });
  const catalogoPapel = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: `Couché 250g ${s}` },
  });
  const papel = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoPapel.id, precoCompra: 1.2 },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return { graficaId: grafica.id, usuarioDonoId: usuarioDono.id, papelId: papel.id };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.formatoFolha.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

async function comoUsuario(usuarioId: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(usuario as never);
}

describe("salvarFormatosFolhaPapel — achado A1 da auditoria do motor de preço", () => {
  it(
    "grava formatos de folha na MATERIA_PRIMA — o estado que o motor Digital exige",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.papelId);
      fd.set(
        "formatosFolhaJson",
        JSON.stringify([{ nome: "SRA3 32x45", larguraFolha: "0.32", alturaFolha: "0.45" }])
      );

      const resultado = await salvarFormatosFolhaPapel(null, fd);
      expect(resultado.ok).toBe(true);

      const formatos = await prisma.formatoFolha.findMany({ where: { itemGraficaId: f.papelId } });
      expect(formatos).toHaveLength(1);
      expect(formatos[0].nome).toBe("SRA3 32x45");
      expect(Number(formatos[0].larguraFolha)).toBeCloseTo(0.32, 4);
      expect(Number(formatos[0].alturaFolha)).toBeCloseTo(0.45, 4);
    },
    TIMEOUT_MS
  );

  it(
    "substitui a lista inteira a cada save (delete + recreate, mesmo padrão de salvarTabelaGramatura)",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      await salvarFormatosFolhaPapel(
        null,
        (() => {
          const fd = new FormData();
          fd.set("itemGraficaId", f.papelId);
          fd.set("formatosFolhaJson", JSON.stringify([{ nome: "A", larguraFolha: "0.3", alturaFolha: "0.4" }]));
          return fd;
        })()
      );

      const fd2 = new FormData();
      fd2.set("itemGraficaId", f.papelId);
      fd2.set(
        "formatosFolhaJson",
        JSON.stringify([
          { nome: "B", larguraFolha: "0.5", alturaFolha: "0.6" },
          { nome: "C", larguraFolha: "0.66", alturaFolha: "0.96" },
        ])
      );
      const resultado = await salvarFormatosFolhaPapel(null, fd2);
      expect(resultado.ok).toBe(true);

      const formatos = await prisma.formatoFolha.findMany({
        where: { itemGraficaId: f.papelId },
        orderBy: { nome: "asc" },
      });
      expect(formatos.map((f) => f.nome)).toEqual(["B", "C"]);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita salvar em item que não é MATERIA_PRIMA (ex: um produto)",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: f.graficaId, tipo: "PRODUTO", categoria: "Cartão", nome: "Cartão de visita" },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: f.graficaId, itemCatalogoId: catalogoProduto.id },
      });

      const fd = new FormData();
      fd.set("itemGraficaId", produto.id);
      fd.set("formatosFolhaJson", JSON.stringify([{ nome: "X", larguraFolha: "0.3", alturaFolha: "0.4" }]));

      const resultado = await salvarFormatosFolhaPapel(null, fd);
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita formato com largura/altura zerada",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.papelId);
      fd.set("formatosFolhaJson", JSON.stringify([{ nome: "X", larguraFolha: "0", alturaFolha: "0.4" }]));

      const resultado = await salvarFormatosFolhaPapel(null, fd);
      expect(resultado.ok).toBe(false);

      const formatos = await prisma.formatoFolha.findMany({ where: { itemGraficaId: f.papelId } });
      expect(formatos).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
