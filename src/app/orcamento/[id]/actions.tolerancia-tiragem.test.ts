import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.aviso-bloqueio.test.ts) — cobre o achado B2 da
// auditoria de abrangência (pesquisa-abrangencia-modulos.md): o PDF de
// orçamento nunca declarava a tolerância de tiragem admissível (quebra de
// máquina, acerto de cor — padrão do mercado offset). Orcamento.
// toleranciaTiragemPercent é um SNAPSHOT de ParametrosGrafica.
// toleranciaTiragemPadraoPercent tirado no momento do ENVIO, mesmo mecanismo
// de diasValidadeOrcamentoPadrao → validoAteEm.
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
import { atualizarStatusOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function criarFixture(opts: { toleranciaTiragemPadraoPercent?: number | null } = {}) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Tolerancia Tiragem ${s}`, slug: `teste-tolerancia-tiragem-${s}` },
  });
  if (opts.toleranciaTiragemPadraoPercent !== undefined) {
    await prisma.parametrosGrafica.create({
      data: {
        graficaId: grafica.id,
        toleranciaTiragemPadraoPercent: opts.toleranciaTiragemPadraoPercent,
      },
    });
  }
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-tolerancia-tiragem-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 100, precoCompra: 1 },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "RASCUNHO", total: 100 },
  });
  await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: itemGrafica.id, quantidade: 1, precoUnitario: 100, precoTotal: 100 },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, orcamentoId: orcamento.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

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
}, TIMEOUT_MS);

describe("tolerância de tiragem no envio de orçamento (achado B2)", () => {
  it(
    "grafica sem ParametrosGrafica.toleranciaTiragemPadraoPercent configurado: ENVIADO usa o default 10%",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "ENVIADO" })
      );

      expect(resultado.ok).toBe(true);
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(Number(orcamento.toleranciaTiragemPercent)).toBe(10);
      expect(orcamento.validoAteEm).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "grafica com toleranciaTiragemPadraoPercent=7.5 configurado: ENVIADO usa esse valor, não o default",
    async () => {
      const f = await criarFixture({ toleranciaTiragemPadraoPercent: 7.5 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "ENVIADO" })
      );

      expect(resultado.ok).toBe(true);
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(Number(orcamento.toleranciaTiragemPercent)).toBe(7.5);
    },
    TIMEOUT_MS
  );

  it(
    "reabrir orçamento ENVIADO pra RASCUNHO zera toleranciaTiragemPercent (mesmo ciclo de vida de validoAteEm)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "ENVIADO" })
      );
      const enviado = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(enviado.toleranciaTiragemPercent).not.toBeNull();

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "RASCUNHO" })
      );

      expect(resultado.ok).toBe(true);
      const reaberto = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(reaberto.toleranciaTiragemPercent).toBeNull();
      expect(reaberto.validoAteEm).toBeNull();
    },
    TIMEOUT_MS
  );
});
