import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { carregarContextoPrecificacao } from "./carregar";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/pricing/carregar-bordado-tempo.test.ts) — cobre a
// branch nova de carregarContextoPrecificacao pro achado A5 da Parte 1 da
// auditoria de abrangência (pesquisa-abrangencia-modulos.md): DTF reaproveita
// o MESMO branch/motor de M2 (calcularM2), acrescido de
// custoSubstratoPorPeca/custoPrensagemPorPeca.
//
// IMPORTANTE: a migration 20260905090000_dtf_modelo_calculo foi escrita à
// mão mas NÃO foi aplicada ao banco de dev (regra do projeto). Este arquivo
// só passa depois que alguém aplicar essa migration.
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

async function criarGrafica() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Carregar DTF ${s}`, slug: `teste-carregar-dtf-${s}` },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { grafica, s };
}

describe(
  "carregarContextoPrecificacao — DTF (achado A5)",
  () => {
    it(
      "produto DTF sem nenhuma BobinaMaterial cadastrada: contexto.m2 é montado mesmo assim (bobinas: []) — o erro PECA_EXCEDE_BOBINA só aparece dentro do motor calcularM2, não no carregamento",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta DTF ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "DTF",
            precoCompra: 20, // custo do filme por m²
            custoImpressaoM2: 8,
            custoSubstratoPorPeca: 15,
            custoPrensagemPorPeca: 4,
            // Nenhuma BobinaMaterial cadastrada de propósito.
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        // Branch DTF carrega o mesmo contexto.m2 que M2 usa — bobinas vazio é
        // um estado válido de carregamento (o erro só aparece dentro do
        // motor, quando o nesting de fato roda, ver calcularM2/m2.ts).
        expect(contexto.m2).toBeTruthy();
        expect(contexto.m2?.bobinas).toEqual([]);
        expect(contexto.m2?.custoM2Material).toBe(20);
        expect(contexto.m2?.custoImpressaoM2).toBe(8);
        expect(contexto.m2?.custoSubstratoPorPeca).toBe(15);
        expect(contexto.m2?.custoPrensagemPorPeca).toBe(4);
      },
      TIMEOUT_MS
    );

    it(
      "caminho feliz: carrega bobinas + custoSubstratoPorPeca/custoPrensagemPorPeca do produto DTF",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta DTF ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "DTF",
            precoCompra: 20,
            custoImpressaoM2: 8,
            areaMinimaFaturavel: 0,
            custoSubstratoPorPeca: 15,
            custoPrensagemPorPeca: 4,
            bobinas: { create: [{ larguraNominal: 0.6, refile: 0.01 }] },
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.m2).toMatchObject({
          custoM2Material: 20,
          custoImpressaoM2: 8,
          custoSubstratoPorPeca: 15,
          custoPrensagemPorPeca: 4,
        });
        expect(contexto.m2?.bobinas).toHaveLength(1);
        expect(contexto.m2?.bobinas[0]).toMatchObject({ larguraNominal: 0.6, refile: 0.01 });
      },
      TIMEOUT_MS
    );

    it(
      "produto M2 puro (não-DTF) sem os campos configurados carrega custoSubstratoPorPeca/custoPrensagemPorPeca como 0 — nenhuma regressão",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Banner", nome: `Banner M2 ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "M2",
            precoCompra: 30,
            custoImpressaoM2: 5,
            bobinas: { create: [{ larguraNominal: 1.4, refile: 0.02 }] },
            // custoSubstratoPorPeca/custoPrensagemPorPeca propositalmente NULL
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.m2?.custoSubstratoPorPeca).toBe(0);
        expect(contexto.m2?.custoPrensagemPorPeca).toBe(0);
      },
      TIMEOUT_MS
    );
  }
);
