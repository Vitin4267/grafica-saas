import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  carregarDadosExemplo,
  gerarOrcamentoExemplo,
  limparDadosExemplo,
  existemDadosExemplo,
  PREFIXO_EXEMPLO,
} from "./dados-exemplo";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/custo-pedido.test.ts) — cobre o achado A6 da Parte
// 6 da auditoria de abrangência (2026-08-27): o pacote de dados de exemplo
// carregado passa a depender de Grafica.segmento, com o pacote "padrão"
// (perfil rótulos/etiquetas, Offset) como fallback pra segmento=null.
//
// IMPORTANTE: estes testes dependem da coluna `graficas.segmento`, criada
// pela migration prisma/migrations/20260827100000_grafica_segmento — até
// essa migration ser aplicada ao banco de dev, todo teste aqui falha com
// "column graficas.segmento does not exist" (esperado, não é regressão).
const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    // Dogfooding: usa a própria função de limpeza da feature — cobre
    // qualquer pacote que o teste tenha carregado, sem duplicar a lógica de
    // ordem de exclusão aqui.
    await limparDadosExemplo(graficaId);
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarGrafica(nome: string, segmento?: string) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: {
      nome: `${nome} ${s}`,
      slug: `${nome.toLowerCase().replace(/\s+/g, "-")}-${s}`,
      ...(segmento ? { segmento: segmento as never } : {}),
    },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return grafica;
}

describe("carregarDadosExemplo — escolha de pacote por segmento", () => {
  it(
    "segmento null cai no pacote padrão (Offset)",
    async () => {
      const grafica = await criarGrafica("Teste Exemplo Padrao");

      const resultado = await carregarDadosExemplo(grafica.id);
      expect(resultado.ok).toBe(true);

      const produtoOffset = await prisma.itemCatalogo.findFirst({
        where: { graficaId: grafica.id, nome: `${PREFIXO_EXEMPLO}Cartão de Visita` },
      });
      expect(produtoOffset).not.toBeNull();

      const itemOffset = await prisma.itemGrafica.findFirst({
        where: { graficaId: grafica.id, itemCatalogoId: produtoOffset!.id },
      });
      expect(itemOffset?.modeloCalculo).toBe("OFFSET");
    },
    TIMEOUT_MS
  );

  it(
    "segmento COMUNICACAO_VISUAL carrega o pacote de banner (M2, sem prensa)",
    async () => {
      const grafica = await criarGrafica("Teste Exemplo ComVisual", "COMUNICACAO_VISUAL");

      const resultado = await carregarDadosExemplo(grafica.id);
      expect(resultado.ok).toBe(true);

      const produtoBanner = await prisma.itemCatalogo.findFirst({
        where: { graficaId: grafica.id, nome: `${PREFIXO_EXEMPLO}Banner em Lona` },
      });
      expect(produtoBanner).not.toBeNull();

      const itemBanner = await prisma.itemGrafica.findFirst({
        where: { graficaId: grafica.id, itemCatalogoId: produtoBanner!.id },
        include: { bobinas: true },
      });
      expect(itemBanner?.modeloCalculo).toBe("M2");
      expect(itemBanner?.prensaId).toBeNull();
      expect(itemBanner?.bobinas.length).toBeGreaterThan(0);

      // Pacote padrão (prensa/papel Offset) não deve ter sido criado junto.
      const prensaPadrao = await prisma.prensa.findFirst({ where: { graficaId: grafica.id } });
      expect(prensaPadrao).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "segmento ESTAMPARIA_VESTUARIO carrega o pacote de camiseta (SERIGRAFIA, com máquina de setup por peça)",
    async () => {
      const grafica = await criarGrafica("Teste Exemplo Estamparia", "ESTAMPARIA_VESTUARIO");

      const resultado = await carregarDadosExemplo(grafica.id);
      expect(resultado.ok).toBe(true);

      const produtoCamiseta = await prisma.itemCatalogo.findFirst({
        where: { graficaId: grafica.id, nome: `${PREFIXO_EXEMPLO}Camiseta Estampada` },
      });
      expect(produtoCamiseta).not.toBeNull();

      const itemCamiseta = await prisma.itemGrafica.findFirst({
        where: { graficaId: grafica.id, itemCatalogoId: produtoCamiseta!.id },
      });
      expect(itemCamiseta?.modeloCalculo).toBe("SERIGRAFIA");
      expect(itemCamiseta?.maquinaSetupPorPecaId).not.toBeNull();

      const maquina = await prisma.maquinaSetupPorPeca.findFirst({
        where: { graficaId: grafica.id, nome: `${PREFIXO_EXEMPLO}Mesa Serigráfica` },
      });
      expect(maquina?.tipoProcesso).toBe("SERIGRAFIA");
    },
    TIMEOUT_MS
  );

  it(
    "clicar duas vezes é idempotente — não duplica catálogo",
    async () => {
      const grafica = await criarGrafica("Teste Exemplo Idempotente", "COMUNICACAO_VISUAL");

      await carregarDadosExemplo(grafica.id);
      const segundaChamada = await carregarDadosExemplo(grafica.id);
      expect(segundaChamada).toEqual({ ok: true, jaCarregado: true });

      const produtos = await prisma.itemCatalogo.findMany({
        where: { graficaId: grafica.id, nome: `${PREFIXO_EXEMPLO}Banner em Lona` },
      });
      expect(produtos).toHaveLength(1);
    },
    TIMEOUT_MS
  );
});

describe("gerarOrcamentoExemplo — motor de preço roda sem erro pra cada pacote", () => {
  it(
    "pacote padrão (Offset) gera orçamento com total > 0",
    async () => {
      const grafica = await criarGrafica("Teste Orcamento Padrao");
      const usuario = await prisma.usuario.create({
        data: {
          graficaId: grafica.id,
          nome: "Dono Teste",
          email: `dono-${sufixo()}@teste.com`,
          senhaHash: "hash",
          papel: "DONO",
        },
      });

      const resultado = await gerarOrcamentoExemplo(grafica.id, usuario.id);
      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        const orcamento = await prisma.orcamento.findUnique({ where: { id: resultado.orcamentoId } });
        expect(Number(orcamento?.total)).toBeGreaterThan(0);
      }
    },
    TIMEOUT_MS
  );

  it(
    "pacote COMUNICACAO_VISUAL (M2) gera orçamento com total > 0",
    async () => {
      const grafica = await criarGrafica("Teste Orcamento ComVisual", "COMUNICACAO_VISUAL");
      const usuario = await prisma.usuario.create({
        data: {
          graficaId: grafica.id,
          nome: "Dono Teste",
          email: `dono-${sufixo()}@teste.com`,
          senhaHash: "hash",
          papel: "DONO",
        },
      });

      const resultado = await gerarOrcamentoExemplo(grafica.id, usuario.id);
      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        const orcamento = await prisma.orcamento.findUnique({ where: { id: resultado.orcamentoId } });
        expect(Number(orcamento?.total)).toBeGreaterThan(0);
      }
    },
    TIMEOUT_MS
  );

  it(
    "pacote ESTAMPARIA_VESTUARIO (SERIGRAFIA) gera orçamento com total > 0",
    async () => {
      const grafica = await criarGrafica("Teste Orcamento Estamparia", "ESTAMPARIA_VESTUARIO");
      const usuario = await prisma.usuario.create({
        data: {
          graficaId: grafica.id,
          nome: "Dono Teste",
          email: `dono-${sufixo()}@teste.com`,
          senhaHash: "hash",
          papel: "DONO",
        },
      });

      const resultado = await gerarOrcamentoExemplo(grafica.id, usuario.id);
      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        const orcamento = await prisma.orcamento.findUnique({ where: { id: resultado.orcamentoId } });
        expect(Number(orcamento?.total)).toBeGreaterThan(0);
      }
    },
    TIMEOUT_MS
  );
});

describe("limparDadosExemplo — remove qualquer pacote", () => {
  it(
    "remove cliente e catálogo do pacote ESTAMPARIA_VESTUARIO por completo",
    async () => {
      const grafica = await criarGrafica("Teste Limpar Estamparia", "ESTAMPARIA_VESTUARIO");
      await carregarDadosExemplo(grafica.id);
      expect(await existemDadosExemplo(grafica.id)).toBe(true);

      const resultado = await limparDadosExemplo(grafica.id);
      expect(resultado.ok).toBe(true);

      expect(await existemDadosExemplo(grafica.id)).toBe(false);
      const maquina = await prisma.maquinaSetupPorPeca.findFirst({ where: { graficaId: grafica.id } });
      expect(maquina).toBeNull();
      const itensRestantes = await prisma.itemCatalogo.findMany({ where: { graficaId: grafica.id } });
      expect(itensRestantes).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
