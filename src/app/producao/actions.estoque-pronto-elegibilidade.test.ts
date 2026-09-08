import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Estoque de produto pré-produzido (pedido direto do dono, 2026-09-08 — ver
// deep-zooming-parasol.md) — previsaoBaixaEstoque (a Server Action que
// alimenta o painel de confirmação "Iniciar impressão") ganha uma segunda
// lista, itensElegiveisEstoque: só produtos com estoque pré-produzido
// SUFICIENTE pra cobrir a quantidade pedida aparecem, oferecendo o checkbox
// "atender do estoque" na UI. Mesmo padrão de mock de auth de
// actions.custo-auditoria.test.ts.
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
import { previsaoBaixaEstoque } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function criarFixture(estoqueProduto: number | null): Promise<{
  graficaId: string;
  usuarioId: string;
  pedidoId: string;
  nomeProduto: string;
}> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Elegibilidade ${s}`, slug: `teste-elegibilidade-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-elegibilidade-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });

  const nomeProduto = `Cartão de Visita ${s}`;
  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: nomeProduto },
  });
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id, estoqueAtual: estoqueProduto },
  });

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 500 },
  });
  await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: produto.id,
      quantidade: 10,
      precoUnitario: 50,
      precoTotal: 500,
    },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return { graficaId: grafica.id, usuarioId: usuario.id, pedidoId: pedido.id, nomeProduto };
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
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

describe("previsaoBaixaEstoque — itensElegiveisEstoque (estoque de produto pré-produzido)", () => {
  it(
    "estoque suficiente (>= quantidade pedida): item aparece como elegível",
    async () => {
      const f = await criarFixture(50); // pedido é de 10, 50 >= 10
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await previsaoBaixaEstoque(f.pedidoId);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      expect(resultado.itensElegiveisEstoque).toHaveLength(1);
      expect(resultado.itensElegiveisEstoque[0].nomeProduto).toBe(f.nomeProduto);
      expect(resultado.itensElegiveisEstoque[0].quantidadePedida).toBe(10);
      expect(resultado.itensElegiveisEstoque[0].estoqueDisponivel).toBe(50);
    },
    TIMEOUT_MS
  );

  it(
    "estoque insuficiente (< quantidade pedida): item NÃO aparece como elegível",
    async () => {
      const f = await criarFixture(5); // pedido é de 10, 5 < 10
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await previsaoBaixaEstoque(f.pedidoId);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      expect(resultado.itensElegiveisEstoque).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "produto nunca pré-produzido (estoqueAtual null): item NÃO aparece como elegível",
    async () => {
      const f = await criarFixture(null);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await previsaoBaixaEstoque(f.pedidoId);
      expect(resultado.ok).toBe(true);
      if (!resultado.ok) return;
      expect(resultado.itensElegiveisEstoque).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
