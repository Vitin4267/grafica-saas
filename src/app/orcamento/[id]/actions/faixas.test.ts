import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de opcoes.test.ts) — cobre o achado B5 da auditoria de
// abrangência (Parte 1): tabela de faixas de quantidade alternativas do
// MESMO item ("1.000/3.000/5.000 unidades"), ver model
// OrcamentoItemFaixaQuantidade (schema 09-orcamento.prisma) e
// src/lib/orcamento-faixas-quantidade.ts.

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
import { adicionarItemOrcamento } from "./itens";
import { adicionarFaixaQuantidadeOrcamento, removerFaixaQuantidadeOrcamento } from "./faixas";
import { MAX_FAIXAS_QUANTIDADE } from "@/lib/orcamento-faixas-quantidade";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
    await prisma.orcamentoItemFaixaQuantidade.deleteMany({
      where: { orcamentoItem: { orcamento: { graficaId } } },
    });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    // itemGrafica ANTES de maquinaSetupPorPeca — ItemGrafica.maquinaSetupPorPecaId
    // é RESTRICT (não CASCADE), então apagar a máquina primeiro com o item
    // ainda referenciando ela falha com violação de FK.
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.maquinaSetupPorPeca.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

// Fixture SIMPLES — preço linear (precoUnitario constante, precoTotal =
// precoUnitario × quantidade), suficiente pra cobrir CRUD/ownership/status
// sem precisar de catálogo avançado.
async function criarFixtureSimples() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Faixas ${s}`, slug: `teste-faixas-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-faixas-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const precoVenda = 50;
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "RASCUNHO", total: 0 },
  });

  return { graficaId: grafica.id, usuarioDonoId: usuarioDono.id, itemGraficaId: itemGrafica.id, orcamentoId: orcamento.id, precoVenda };
}

async function adicionarItemBase(
  fixture: { orcamentoId: string; itemGraficaId: string; usuarioDonoId: string },
  quantidade: number
): Promise<string> {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await usuarioParaMock(fixture.usuarioDonoId)) as never
  );
  const resultado = await adicionarItemOrcamento(
    null,
    formDataDe({
      orcamentoId: fixture.orcamentoId,
      itemGraficaId: fixture.itemGraficaId,
      quantidade: String(quantidade),
      unidadeDimensao: "CM",
    })
  );
  expect(resultado.ok).toBe(true);
  const item = await prisma.orcamentoItem.findFirstOrThrow({
    where: { orcamentoId: fixture.orcamentoId, opcaoId: null },
  });
  return item.id;
}

describe("adicionarFaixaQuantidadeOrcamento / removerFaixaQuantidadeOrcamento", () => {
  it(
    "recalcula a faixa pelo mesmo motor (SIMPLES: preço linear) e não mexe em Orcamento.total",
    async () => {
      const fixture = await criarFixtureSimples();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const orcamentoItemId = await adicionarItemBase(fixture, 10); // item base = 10 × 50 = 500

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const resultado = await adicionarFaixaQuantidadeOrcamento(
        null,
        formDataDe({ orcamentoItemId, quantidade: "30" })
      );
      expect(resultado.ok).toBe(true);

      const faixa = await prisma.orcamentoItemFaixaQuantidade.findFirstOrThrow({
        where: { orcamentoItemId },
      });
      expect(faixa.quantidade).toBe(30);
      expect(Number(faixa.precoUnitario)).toBe(fixture.precoVenda);
      expect(Number(faixa.precoTotal)).toBe(30 * fixture.precoVenda);

      // Faixa é só uma tabela COMPARATIVA — nunca soma no total do orçamento
      // nem muda o item principal.
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: fixture.orcamentoId } });
      expect(Number(orcamento.total)).toBe(500);
      const itemPrincipal = await prisma.orcamentoItem.findUniqueOrThrow({ where: { id: orcamentoItemId } });
      expect(itemPrincipal.quantidade).toBe(10);
    },
    TIMEOUT_MS
  );

  it(
    "SERIGRAFIA (setup-por-peça): faixa com quantidade maior dilui o setup — unitário menor que o do item base",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Faixas Serigrafia ${s}`, slug: `teste-faixas-serigrafia-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
      const usuarioDono = await prisma.usuario.create({
        data: {
          graficaId: grafica.id,
          nome: `Dono ${s}`,
          email: `dono-faixas-serigrafia-${s}@example.com`,
          senhaHash: "x",
          papel: "DONO",
        },
      });
      const maquina = await prisma.maquinaSetupPorPeca.create({
        data: {
          graficaId: grafica.id,
          nome: `Carrossel 6 cores ${s}`,
          tipoProcesso: "SERIGRAFIA",
          custoPorSetup: 80,
          custoPorPeca: 3.5,
          custoMinimo: 0,
        },
      });
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta Serigrafia ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: {
          graficaId: grafica.id,
          itemCatalogoId: catalogo.id,
          modeloCalculo: "SERIGRAFIA",
          precoCompra: 15,
          // adicionarItemOrcamento filtra precoVenda: { not: null } na query
          // (guarda genérica pro branch SIMPLES) mesmo pra um modelo avançado
          // que não usa este campo no cálculo — precisa estar preenchido só
          // pra passar por esse filtro.
          precoVenda: 999,
          maquinaSetupPorPecaId: maquina.id,
        },
      });
      const orcamento = await prisma.orcamento.create({
        data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "RASCUNHO", total: 0 },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(usuarioDono as never);
      const itemResultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: "10",
          unidadeDimensao: "CM",
          numeroSetups: "1",
        })
      );
      expect(itemResultado.ok).toBe(true);
      const itemBase = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: orcamento.id, opcaoId: null },
      });

      const faixaResultado = await adicionarFaixaQuantidadeOrcamento(
        null,
        formDataDe({ orcamentoItemId: itemBase.id, quantidade: "200" })
      );
      expect(faixaResultado.ok).toBe(true);

      const faixa = await prisma.orcamentoItemFaixaQuantidade.findFirstOrThrow({
        where: { orcamentoItemId: itemBase.id },
      });
      // O mesmo custo de setup (R$80) dividido entre 200 peças pesa muito
      // menos por peça do que dividido entre 10 — o motor dilui sozinho, sem
      // nenhuma lógica de cálculo duplicada nesta feature.
      expect(Number(faixa.precoUnitario)).toBeLessThan(Number(itemBase.precoUnitario));
      expect(faixa.breakdown).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "rejeita quantidade inválida (zero, negativa, fracionária)",
    async () => {
      const fixture = await criarFixtureSimples();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const orcamentoItemId = await adicionarItemBase(fixture, 10);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      for (const quantidade of ["0", "-5", "1.5"]) {
        const resultado = await adicionarFaixaQuantidadeOrcamento(
          null,
          formDataDe({ orcamentoItemId, quantidade })
        );
        expect(resultado.ok).toBe(false);
      }
      const total = await prisma.orcamentoItemFaixaQuantidade.count({ where: { orcamentoItemId } });
      expect(total).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "só permite adicionar/remover faixa enquanto o orçamento está em rascunho",
    async () => {
      const fixture = await criarFixtureSimples();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const orcamentoItemId = await adicionarItemBase(fixture, 10);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      const faixaAntes = await adicionarFaixaQuantidadeOrcamento(
        null,
        formDataDe({ orcamentoItemId, quantidade: "30" })
      );
      expect(faixaAntes.ok).toBe(true);
      const faixa = await prisma.orcamentoItemFaixaQuantidade.findFirstOrThrow({
        where: { orcamentoItemId },
      });

      await prisma.orcamento.update({ where: { id: fixture.orcamentoId }, data: { status: "ENVIADO" } });

      const novaFaixa = await adicionarFaixaQuantidadeOrcamento(
        null,
        formDataDe({ orcamentoItemId, quantidade: "50" })
      );
      expect(novaFaixa.ok).toBe(false);

      const remocao = await removerFaixaQuantidadeOrcamento(null, formDataDe({ faixaId: faixa.id }));
      expect(remocao.ok).toBe(false);

      const total = await prisma.orcamentoItemFaixaQuantidade.count({ where: { orcamentoItemId } });
      expect(total).toBe(1); // nem a nova foi criada, nem a existente foi removida
    },
    TIMEOUT_MS
  );

  it(
    `respeita o teto de ${MAX_FAIXAS_QUANTIDADE} faixas por item`,
    async () => {
      const fixture = await criarFixtureSimples();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const orcamentoItemId = await adicionarItemBase(fixture, 10);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      for (let i = 0; i < MAX_FAIXAS_QUANTIDADE; i++) {
        const resultado = await adicionarFaixaQuantidadeOrcamento(
          null,
          formDataDe({ orcamentoItemId, quantidade: String(20 + i) })
        );
        expect(resultado.ok).toBe(true);
      }
      const resultadoExtra = await adicionarFaixaQuantidadeOrcamento(
        null,
        formDataDe({ orcamentoItemId, quantidade: "999" })
      );
      expect(resultadoExtra.ok).toBe(false);

      const total = await prisma.orcamentoItemFaixaQuantidade.count({ where: { orcamentoItemId } });
      expect(total).toBe(MAX_FAIXAS_QUANTIDADE);
    },
    TIMEOUT_MS
  );

  it(
    "isolamento multi-tenant: usuário de outra gráfica não adiciona nem remove faixa alheia",
    async () => {
      const fixtureA = await criarFixtureSimples();
      graficaIdsParaLimpar.push(fixtureA.graficaId);
      const orcamentoItemId = await adicionarItemBase(fixtureA, 10);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixtureA.usuarioDonoId)) as never
      );
      const faixaResultado = await adicionarFaixaQuantidadeOrcamento(
        null,
        formDataDe({ orcamentoItemId, quantidade: "30" })
      );
      expect(faixaResultado.ok).toBe(true);
      const faixa = await prisma.orcamentoItemFaixaQuantidade.findFirstOrThrow({
        where: { orcamentoItemId },
      });

      const fixtureB = await criarFixtureSimples();
      graficaIdsParaLimpar.push(fixtureB.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixtureB.usuarioDonoId)) as never
      );

      // Usuário B tentando adicionar faixa num item de A.
      const tentativaAdicionar = await adicionarFaixaQuantidadeOrcamento(
        null,
        formDataDe({ orcamentoItemId, quantidade: "40" })
      );
      expect(tentativaAdicionar.ok).toBe(false);

      // Usuário B tentando remover a faixa de A.
      const tentativaRemover = await removerFaixaQuantidadeOrcamento(
        null,
        formDataDe({ faixaId: faixa.id })
      );
      expect(tentativaRemover.ok).toBe(false);

      const aindaExiste = await prisma.orcamentoItemFaixaQuantidade.findUnique({ where: { id: faixa.id } });
      expect(aindaExiste).not.toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "remove só a faixa alvo, sem afetar outras faixas do mesmo item",
    async () => {
      const fixture = await criarFixtureSimples();
      graficaIdsParaLimpar.push(fixture.graficaId);
      const orcamentoItemId = await adicionarItemBase(fixture, 10);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioDonoId)) as never
      );
      await adicionarFaixaQuantidadeOrcamento(null, formDataDe({ orcamentoItemId, quantidade: "20" }));
      await adicionarFaixaQuantidadeOrcamento(null, formDataDe({ orcamentoItemId, quantidade: "40" }));
      const faixas = await prisma.orcamentoItemFaixaQuantidade.findMany({
        where: { orcamentoItemId },
        orderBy: { quantidade: "asc" },
      });
      expect(faixas).toHaveLength(2);

      const resultado = await removerFaixaQuantidadeOrcamento(
        null,
        formDataDe({ faixaId: faixas[0].id })
      );
      expect(resultado.ok).toBe(true);

      const restantes = await prisma.orcamentoItemFaixaQuantidade.findMany({ where: { orcamentoItemId } });
      expect(restantes).toHaveLength(1);
      expect(restantes[0].id).toBe(faixas[1].id);
    },
    TIMEOUT_MS
  );
});
