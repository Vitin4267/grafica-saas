import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.desconto.test.ts) — cobre o
// achado F7 da Parte 7 da auditoria de abrangência: OrcamentoItem ganhou
// profundidadeCm/espessuraMm (item de orçamento com 3 dimensões — caixa/
// embalagem, acrílico, livro — e espessura de chapa do item VENDIDO, corte a
// laser/router). Cobre adicionarItemOrcamento e editarOrcamento (fluxo de
// FormData direto na tela de detalhe do orçamento).
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
import { adicionarItemOrcamento, editarOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  clienteId: string;
  itemGraficaId: string;
  orcamentoId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Dimensoes Item Detalhe ${s}`, slug: `teste-dimensoes-item-detalhe-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-dimensoes-detalhe-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  // Produto SIMPLES — o suficiente pra exercitar profundidadeCm/espessuraMm,
  // que nenhum motor de preço usa (nem SIMPLES nem M2/OFFSET).
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Embalagem", nome: `Caixa Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 10 },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "RASCUNHO", total: 0 },
  });

  return {
    graficaId: grafica.id,
    usuarioId: usuario.id,
    clienteId: cliente.id,
    itemGraficaId: itemGrafica.id,
    orcamentoId: orcamento.id,
  };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
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
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("adicionarItemOrcamento — profundidade/espessuraMm (achado F7)", () => {
  it(
    "grava profundidadeCm convertida pra cm (mesma conversão de largura/altura) e espessuraMm direto",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "5",
          // Digitado em MM: profundidade 200mm -> 20cm gravado.
          unidadeDimensao: "MM",
          profundidade: "200",
          espessuraMm: "3",
        })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item.profundidadeCm?.toString()).toBe("20");
      expect(item.espessuraMm?.toString()).toBe("3");
      // Preço não é afetado pelos campos novos — SIMPLES sem largura/altura
      // continua precoVenda × quantidade.
      expect(Number(item.precoTotal)).toBe(50);
    },
    TIMEOUT_MS
  );

  it(
    "sem preencher profundidade/espessura, o item continua sendo adicionado normalmente (regressão zero)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "5",
          unidadeDimensao: "CM",
        })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item.profundidadeCm).toBeNull();
      expect(item.espessuraMm).toBeNull();
      expect(Number(item.precoTotal)).toBe(50);
    },
    TIMEOUT_MS
  );
});

describe("editarOrcamento — profundidade/espessuraMm (achado F7)", () => {
  it(
    "atualiza profundidadeCm/espessuraMm de um item existente",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "5",
          unidadeDimensao: "CM",
        })
      );
      const itemCriado = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(itemCriado.profundidadeCm).toBeNull();
      expect(itemCriado.espessuraMm).toBeNull();

      // editarOrcamento recebe larguraCm/alturaCm/profundidadeCm já em cm
      // (EditarOrcamentoForm.tsx converte no client antes de mandar) —
      // espessuraMm é lido direto, sem conversão de unidade.
      const resultado = await editarOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          orcamentoItemId: itemCriado.id,
          quantidade: "5",
          profundidadeCm: "20",
          espessuraMm: "3",
        })
      );

      expect(resultado.ok).toBe(true);
      const itemEditado = await prisma.orcamentoItem.findUniqueOrThrow({
        where: { id: itemCriado.id },
      });
      expect(itemEditado.profundidadeCm?.toString()).toBe("20");
      expect(itemEditado.espessuraMm?.toString()).toBe("3");
    },
    TIMEOUT_MS
  );

  it(
    "editar sem tocar profundidade/espessura mantém os dois null (regressão zero)",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: fixture.itemGraficaId,
          quantidade: "5",
          unidadeDimensao: "CM",
        })
      );
      const itemCriado = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });

      const resultado = await editarOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          orcamentoItemId: itemCriado.id,
          quantidade: "8",
        })
      );

      expect(resultado.ok).toBe(true);
      const itemEditado = await prisma.orcamentoItem.findUniqueOrThrow({
        where: { id: itemCriado.id },
      });
      expect(itemEditado.quantidade).toBe(8);
      expect(itemEditado.profundidadeCm).toBeNull();
      expect(itemEditado.espessuraMm).toBeNull();
      expect(Number(itemEditado.precoTotal)).toBe(80);
    },
    TIMEOUT_MS
  );
});
