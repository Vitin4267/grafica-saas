import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.desconto.test.ts e
// status-transicao.custo-automatico.test.ts) — cobre o achado A1-Parte6 da
// auditoria de abrangência (2026-08-24): ParametrosGrafica.comissaoEntraNoCustoPedido
// existia no schema sem nenhum código consumindo. Este arquivo cobre a
// implementação: aprovar um orçamento com vendedor comissionado espelha a
// Comissao como um CustoPedido (origem COMISSAO) quando o flag está ligado,
// e preserva o comportamento de hoje (nada extra) quando desligado.
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

type Fixture = {
  graficaId: string;
  categoriaCustoId: string;
  vendedorId: string;
  orcamentoId: string;
  valorComissaoEsperado: number;
};

// Vendedor com 10% de comissão sobre o VALOR do orçamento (default
// comissaoVendedorBase), orçamento de R$1.000 → comissão esperada R$100.
async function criarFixture(opts: { comissaoEntraNoCustoPedido: boolean }): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Comissao Custo ${s}`, slug: `teste-comissao-custo-${s}` },
  });
  await prisma.parametrosGrafica.create({
    data: { graficaId: grafica.id, comissaoEntraNoCustoPedido: opts.comissaoEntraNoCustoPedido },
  });
  // Categoria "Comissão" de propósito — exercita o caminho preferencial de
  // criarCustoAutomaticoComissao (achar por nome), não o fallback.
  const categoria = await prisma.categoriaCusto.create({
    data: { graficaId: grafica.id, nome: "Comissão" },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const vendedor = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Vendedor ${s}`,
      email: `vendedor-comissao-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      comissaoPercent: 0.1,
    },
  });

  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 1000, precoCompra: 1 },
  });

  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: vendedor.id,
      status: "ENVIADO",
      total: 1000,
    },
  });
  await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: itemGrafica.id,
      quantidade: 1,
      precoUnitario: 1000,
      precoTotal: 1000,
    },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    categoriaCustoId: categoria.id,
    vendedorId: vendedor.id,
    orcamentoId: orcamento.id,
    valorComissaoEsperado: 100, // 10% de 1000
  };
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
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("aprovação de orçamento — comissão espelhada em CustoPedido (achado A1-Parte6)", () => {
  it(
    "comissaoEntraNoCustoPedido=true: gera CustoPedido origem COMISSAO na categoria 'Comissão'",
    async () => {
      const f = await criarFixture({ comissaoEntraNoCustoPedido: true });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedorId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { orcamentoId: f.orcamentoId } });
      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: pedido.id } });
      expect(custos).toHaveLength(1);
      expect(custos[0].origem).toBe("COMISSAO");
      expect(custos[0].categoriaCustoId).toBe(f.categoriaCustoId);
      expect(Number(custos[0].valor)).toBeCloseTo(f.valorComissaoEsperado, 2);
    },
    TIMEOUT_MS
  );

  it(
    "comissaoEntraNoCustoPedido=false (default): Comissao é criada normalmente, mas nenhum CustoPedido nasce",
    async () => {
      const f = await criarFixture({ comissaoEntraNoCustoPedido: false });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedorId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUnique({ where: { orcamentoId: f.orcamentoId } });
      expect(comissao).not.toBeNull();
      expect(Number(comissao!.valorComissao)).toBeCloseTo(f.valorComissaoEsperado, 2);

      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { orcamentoId: f.orcamentoId } });
      const custos = await prisma.custoPedido.findMany({ where: { pedidoId: pedido.id } });
      expect(custos).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
