import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolverItemParaNcm } from "./catalogo-ncm";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL) —
// regressão do IDOR encontrado na auditoria de 2026-07-23 (Bloco 1): antes
// da correção, salvarNcm deixava qualquer gráfica editar o NCM de um item do
// catálogo MESTRE (compartilhado por design entre todas as gráficas), o que
// propagava a mudança pro catálogo de todas as outras gráficas sem elas
// saberem. Fora do padrão de teste puro do resto do projeto de propósito,
// mesmo motivo de rate-limit.test.ts. Timeout de 30s por teste (não 5s
// padrão) porque cada um faz 3-4 round-trips sequenciais pro Postgres de dev
// na Neon, incluindo o cold start ocasional do compute serverless.
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function criarGrafica() {
  const s = sufixo();
  return prisma.grafica.create({ data: { nome: `Teste NCM ${s}`, slug: `teste-ncm-${s}` } });
}

const limpeza: { graficaIds: string[]; itemCatalogoIds: string[] } = {
  graficaIds: [],
  itemCatalogoIds: [],
};

afterEach(async () => {
  // Por graficaId OU itemCatalogoId (não só graficaId): cobre o item MESTRE,
  // que não pertence a nenhuma gráfica de teste, mas tem ItemGrafica de teste
  // apontando pra ele — sem isso o delete do itemCatalogo abaixo esbarra na
  // FK RESTRICT de itens_grafica.
  await prisma.itemGrafica.deleteMany({
    where: {
      OR: [
        { graficaId: { in: limpeza.graficaIds } },
        { itemCatalogoId: { in: limpeza.itemCatalogoIds } },
      ],
    },
  });
  await prisma.itemCatalogo.deleteMany({ where: { id: { in: limpeza.itemCatalogoIds } } });
  await prisma.grafica.deleteMany({ where: { id: { in: limpeza.graficaIds } } });
  limpeza.graficaIds.length = 0;
  limpeza.itemCatalogoIds.length = 0;
}, TIMEOUT_MS);

describe("resolverItemParaNcm — regressão de IDOR em item mestre (2026-07-23)", () => {
  it(
    "bloqueia edição de NCM de item do catálogo MESTRE (graficaId=null)",
    async () => {
      const grafica = await criarGrafica();
      limpeza.graficaIds.push(grafica.id);

      const itemMestre = await prisma.itemCatalogo.create({
        data: { graficaId: null, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão de Visita ${sufixo()}` },
      });
      limpeza.itemCatalogoIds.push(itemMestre.id);

      await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: itemMestre.id },
      });

      const resultado = await resolverItemParaNcm(itemMestre.id, grafica.id);
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.motivo).toBe("item_mestre");
      }
    },
    TIMEOUT_MS
  );

  it(
    "permite edição de NCM de item PRIVADO da própria gráfica",
    async () => {
      const grafica = await criarGrafica();
      limpeza.graficaIds.push(grafica.id);

      const itemPrivado = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Item privado ${sufixo()}` },
      });
      limpeza.itemCatalogoIds.push(itemPrivado.id);

      const itemGrafica = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: itemPrivado.id },
      });

      const resultado = await resolverItemParaNcm(itemPrivado.id, grafica.id);
      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        expect(resultado.itemGraficaId).toBe(itemGrafica.id);
      }
    },
    TIMEOUT_MS
  );

  it(
    "bloqueia (não encontrado) item PRIVADO de OUTRA gráfica — isolamento multi-tenant",
    async () => {
      const graficaA = await criarGrafica();
      const graficaB = await criarGrafica();
      limpeza.graficaIds.push(graficaA.id, graficaB.id);

      const itemDaGraficaA = await prisma.itemCatalogo.create({
        data: { graficaId: graficaA.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Item da A ${sufixo()}` },
      });
      limpeza.itemCatalogoIds.push(itemDaGraficaA.id);

      await prisma.itemGrafica.create({
        data: { graficaId: graficaA.id, itemCatalogoId: itemDaGraficaA.id },
      });

      // Gráfica B tenta editar o NCM de um item que só existe pra gráfica A.
      const resultado = await resolverItemParaNcm(itemDaGraficaA.id, graficaB.id);
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.motivo).toBe("nao_encontrado");
      }
    },
    TIMEOUT_MS
  );
});
