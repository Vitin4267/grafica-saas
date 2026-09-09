import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.conta-financeira-filial.test.ts) — cobre o achado
// A5 da Parte 3 (Compras) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md): vínculo OPCIONAL de Despesa a
// Fornecedor, 100% aditivo, sem nenhuma automação financeira (regressão
// zero pra Despesa sem fornecedorId). FALHA ESPERADA até a migration
// 20260909100000_fornecedor_enriquecido ser aplicada ao banco (mesmo padrão
// já documentado em actions.baixa-parcial.test.ts).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
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
import { criarDespesa, editarDespesa } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Despesa Fornecedor ${s}`, slug: `teste-despesa-fornecedor-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-despesa-fornecedor-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const fornecedor = await prisma.fornecedor.create({
    data: { graficaId: grafica.id, nome: `Fornecedor ${s}` },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, fornecedorId: fornecedor.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function logarComo(usuarioId: string) {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })) as never
  );
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.fornecedor.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("Despesa.fornecedorId — opcional (achado A5 da Parte 3/Compras)", () => {
  it(
    "criarDespesa: com fornecedorId, grava o vínculo",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({
          descricao: "Compra avulsa de papel",
          valor: "1200",
          vencimento: "2026-10-01",
          fornecedorId: f.fornecedorId,
        })
      );

      expect(resultado.ok).toBe(true);
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Compra avulsa de papel" },
      });
      expect(despesa.fornecedorId).toBe(f.fornecedorId);
    },
    TIMEOUT_MS
  );

  it(
    "criarDespesa: sem fornecedorId (campo nem enviado), fica null — REGRESSÃO ZERO, comportamento de hoje preservado",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({ descricao: "Despesa sem fornecedor", valor: "200", vencimento: "2026-10-01" })
      );

      expect(resultado.ok).toBe(true);
      const despesa = await prisma.despesa.findFirstOrThrow({
        where: { graficaId: f.graficaId, descricao: "Despesa sem fornecedor" },
      });
      expect(despesa.fornecedorId).toBeNull();
      // Nenhuma automação financeira disparada — escopo desta rodada é só
      // cadastro/vínculo informativo (ver comentário no schema).
      const totalDespesas = await prisma.despesa.count({ where: { graficaId: f.graficaId } });
      expect(totalDespesas).toBe(1);
    },
    TIMEOUT_MS
  );

  it(
    "criarDespesa: fornecedorId de outra gráfica é rejeitado (isolamento de tenant)",
    async () => {
      const f = await criarFixture();
      const outra = await criarFixture();
      await logarComo(f.usuarioId);

      const resultado = await criarDespesa(
        null,
        formDataDe({
          descricao: "Despesa fornecedor alheio",
          valor: "200",
          vencimento: "2026-10-01",
          fornecedorId: outra.fornecedorId,
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("Fornecedor não encontrado");
    },
    TIMEOUT_MS
  );

  it(
    "editarDespesa: troca o fornecedor vinculado, e consegue voltar a 'sem fornecedor específico'",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const despesa = await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa editável",
          valor: 300,
          vencimento: new Date("2026-10-01T00:00:00Z"),
          fornecedorId: f.fornecedorId,
        },
      });

      const semFornecedor = await editarDespesa(
        null,
        formDataDe({
          despesaId: despesa.id,
          descricao: "Despesa editável",
          valor: "300",
          vencimento: "2026-10-01",
        })
      );
      expect(semFornecedor.ok).toBe(true);
      const atualizada = await prisma.despesa.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(atualizada.fornecedorId).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "editarDespesa sem tocar em fornecedorId (form antigo, sem o campo) preserva o comportamento de hoje pra todos os OUTROS campos",
    async () => {
      const f = await criarFixture();
      await logarComo(f.usuarioId);
      const despesa = await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa antiga",
          valor: 300,
          vencimento: new Date("2026-10-01T00:00:00Z"),
        },
      });

      const resultado = await editarDespesa(
        null,
        formDataDe({
          despesaId: despesa.id,
          descricao: "Despesa antiga editada",
          valor: "350",
          vencimento: "2026-11-01",
        })
      );

      expect(resultado.ok).toBe(true);
      const atualizada = await prisma.despesa.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(atualizada.descricao).toBe("Despesa antiga editada");
      expect(Number(atualizada.valor)).toBe(350);
      expect(atualizada.fornecedorId).toBeNull();
    },
    TIMEOUT_MS
  );
});
