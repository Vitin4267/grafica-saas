import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/catalogo/[itemGraficaId]/acabamento-estrutural.test.ts)
// — cobre a branch nova de salvarModeloProduto pro achado A5 da Parte 1 da
// auditoria de abrangência (pesquisa-abrangencia-modulos.md): escolher
// modeloCalculo=DTF salva bobinas (mesmo formato de M2) + os campos
// custoImpressaoM2/areaMinimaFaturavel (reaproveitados de M2) +
// custoSubstratoPorPeca/custoPrensagemPorPeca (novos, exclusivos do DTF).
//
// IMPORTANTE: a migration 20260905090000_dtf_modelo_calculo (enum DTF +
// colunas custoSubstratoPorPeca/custoPrensagemPorPeca) foi escrita à mão mas
// NÃO foi aplicada ao banco de dev (regra do projeto). Este arquivo só passa
// depois que alguém aplicar essa migration.

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
import { salvarModeloProduto } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  itemGraficaId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste DTF ${s}`, slug: `teste-dtf-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-dtf-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      emailVerificadoEm: new Date(),
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta DTF ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return { graficaId: grafica.id, usuarioDonoId: usuarioDono.id, itemGraficaId: itemGrafica.id };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
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

describe("salvarModeloProduto — DTF (achado A5)", () => {
  it(
    "rejeita salvar DTF sem nenhuma bobina (mesma exigência do M2)",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("modeloCalculo", "DTF");
      fd.set("bobinasJson", "[]");
      fd.set("custoImpressaoM2", "8");
      fd.set("custoSubstratoPorPeca", "15");
      fd.set("custoPrensagemPorPeca", "4");

      const resultado = await salvarModeloProduto(null, fd);
      expect(resultado.ok).toBe(false);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.modeloCalculo).toBe("SIMPLES"); // nunca gravou o modelo com o form inválido
    },
    TIMEOUT_MS
  );

  it(
    "salva modeloCalculo=DTF + bobinas + custoImpressaoM2 + custoSubstratoPorPeca + custoPrensagemPorPeca",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("modeloCalculo", "DTF");
      fd.set(
        "bobinasJson",
        JSON.stringify([{ larguraNominal: "0.6", refile: "0.01" }])
      );
      fd.set("custoImpressaoM2", "8.5");
      fd.set("areaMinimaFaturavel", "0");
      fd.set("custoSubstratoPorPeca", "15.9");
      fd.set("custoPrensagemPorPeca", "4.25");

      const resultado = await salvarModeloProduto(null, fd);
      expect(resultado.ok).toBe(true);

      const item = await prisma.itemGrafica.findUniqueOrThrow({
        where: { id: f.itemGraficaId },
        include: { bobinas: true },
      });
      expect(item.modeloCalculo).toBe("DTF");
      expect(Number(item.custoImpressaoM2)).toBeCloseTo(8.5, 4);
      expect(Number(item.custoSubstratoPorPeca)).toBeCloseTo(15.9, 4);
      expect(Number(item.custoPrensagemPorPeca)).toBeCloseTo(4.25, 4);
      expect(item.bobinas).toHaveLength(1);
      expect(Number(item.bobinas[0].larguraNominal)).toBeCloseTo(0.6, 4);
    },
    TIMEOUT_MS
  );

  it(
    "custoSubstratoPorPeca/custoPrensagemPorPeca ausentes no form gravam 0 (não NULL) — mesmo default de custoImpressaoM2",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("modeloCalculo", "DTF");
      fd.set("bobinasJson", JSON.stringify([{ larguraNominal: "0.6", refile: "0.01" }]));
      // custoImpressaoM2/custoSubstratoPorPeca/custoPrensagemPorPeca de propósito ausentes

      const resultado = await salvarModeloProduto(null, fd);
      expect(resultado.ok).toBe(true);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(Number(item.custoSubstratoPorPeca)).toBe(0);
      expect(Number(item.custoPrensagemPorPeca)).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita custoSubstratoPorPeca negativo",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("modeloCalculo", "DTF");
      fd.set("bobinasJson", JSON.stringify([{ larguraNominal: "0.6", refile: "0.01" }]));
      fd.set("custoSubstratoPorPeca", "-5");

      const resultado = await salvarModeloProduto(null, fd);
      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );
});
