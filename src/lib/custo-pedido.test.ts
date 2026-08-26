import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { listarInsumosComPrecoDesatualizado } from "./custo-pedido";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/producao/status-transicao.custo-automatico.test.ts)
// — cobre a implementação do achado A1-Parte6 da auditoria de abrangência
// (2026-08-24): ItemGrafica.precoCompraAtualizadoEm null (todo cadastro
// anterior a esta feature) nunca deve aparecer no aviso — "sem dado" é
// diferente de "está velho".
const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const DIA_MS = 86_400_000;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarMateriaPrima(
  graficaId: string,
  nome: string,
  precoCompraAtualizadoEm: Date | null
) {
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId, tipo: "MATERIA_PRIMA", categoria: "Papel", nome },
  });
  return prisma.itemGrafica.create({
    data: { graficaId, itemCatalogoId: catalogo.id, precoCompra: 1, precoCompraAtualizadoEm },
  });
}

describe("listarInsumosComPrecoDesatualizado", () => {
  it(
    "item com precoCompraAtualizadoEm null (nunca rastreado) NÃO aparece — sem dado é 'não sei', nunca 'está velho'",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Preço Desatualizado ${s}`, slug: `teste-preco-desatualizado-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      await prisma.parametrosGrafica.create({
        data: { graficaId: grafica.id, diasPrecoInsumoDesatualizado: 30 },
      });
      await criarMateriaPrima(grafica.id, `Papel nunca rastreado ${s}`, null);

      const resultado = await listarInsumosComPrecoDesatualizado(grafica.id);
      expect(resultado).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "item atualizado recentemente (dentro do limiar) não aparece; item mais velho que o limiar aparece",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Preço Desatualizado ${s}`, slug: `teste-preco-desatualizado-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      await prisma.parametrosGrafica.create({
        data: { graficaId: grafica.id, diasPrecoInsumoDesatualizado: 30 },
      });

      const recente = await criarMateriaPrima(
        grafica.id,
        `Papel recente ${s}`,
        new Date(Date.now() - 5 * DIA_MS)
      );
      const velho = await criarMateriaPrima(
        grafica.id,
        `Papel velho ${s}`,
        new Date(Date.now() - 45 * DIA_MS)
      );

      const resultado = await listarInsumosComPrecoDesatualizado(grafica.id);
      expect(resultado).toContain(velho.id);
      expect(resultado).not.toContain(recente.id);
    },
    TIMEOUT_MS
  );

  it(
    "sem ParametrosGrafica cadastrado, cai no default de 90 dias",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Preço Desatualizado ${s}`, slug: `teste-preco-desatualizado-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      // Sem prisma.parametrosGrafica.create — testa o fallback ?? 90.

      const dentro = await criarMateriaPrima(
        grafica.id,
        `Papel 60 dias ${s}`,
        new Date(Date.now() - 60 * DIA_MS)
      );
      const fora = await criarMateriaPrima(
        grafica.id,
        `Papel 120 dias ${s}`,
        new Date(Date.now() - 120 * DIA_MS)
      );

      const resultado = await listarInsumosComPrecoDesatualizado(grafica.id);
      expect(resultado).toContain(fora.id);
      expect(resultado).not.toContain(dentro.id);
    },
    TIMEOUT_MS
  );
});
