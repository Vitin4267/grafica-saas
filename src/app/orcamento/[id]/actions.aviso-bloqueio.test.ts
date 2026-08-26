import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.comissao-custo.test.ts) — cobre o item deferido do
// achado A9 da auditoria de abrangência (2026-08-24): Cliente.bloqueadoParaVenda
// já existia no schema e era editável, mas atualizarStatusOrcamento nunca
// avisava ninguém ao aprovar orçamento de um cliente bloqueado. O bloqueio é
// deliberadamente NÃO bloqueante (não existe fluxo de "aprovação forçada" no
// produto hoje) — só populamos `aviso` pra a UI mostrar.
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

async function criarFixture(opts: { bloqueadoParaVenda: boolean; motivoBloqueio?: string }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Aviso Bloqueio ${s}`, slug: `teste-aviso-bloqueio-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: {
      graficaId: grafica.id,
      nome: `Cliente ${s}`,
      bloqueadoParaVenda: opts.bloqueadoParaVenda,
      motivoBloqueio: opts.motivoBloqueio ?? null,
    },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-aviso-bloqueio-${s}@example.com`,
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
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "ENVIADO", total: 100 },
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
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.comissao.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
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
}, TIMEOUT_MS);

describe("aprovação de orçamento — aviso de cliente bloqueado pra venda (achado A9, item deferido)", () => {
  it(
    "cliente bloqueadoParaVenda=true: aprova mesmo assim, mas retorna aviso com o motivo",
    async () => {
      const f = await criarFixture({ bloqueadoParaVenda: true, motivoBloqueio: "Inadimplente há 60 dias" });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.aviso).toContain("bloqueado para venda");
      expect(resultado.aviso).toContain("Inadimplente há 60 dias");

      const pedido = await prisma.pedido.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(pedido).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "cliente sem bloqueio (default): aprova sem nenhum aviso",
    async () => {
      const f = await criarFixture({ bloqueadoParaVenda: false });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );

      expect(resultado.ok).toBe(true);
      expect(resultado.aviso).toBeUndefined();
    },
    TIMEOUT_MS
  );
});
