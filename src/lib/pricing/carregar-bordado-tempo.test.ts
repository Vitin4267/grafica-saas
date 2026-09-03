import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { carregarContextoPrecificacao } from "./carregar";
import { ErroPrecificacao } from "./erros";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/pricing/carregar.test.ts) — cobre as 2 branches
// novas de carregarContextoPrecificacao: BORDADO (achado A4) e TEMPO_MAQUINA
// (achado A6) da Parte 1 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md). Cada cenário cobre "máquina não
// configurada" (erro) e "caminho feliz" (contexto carregado do banco).
//
// IMPORTANTE: a migration 20260902100000_bordado_tempo_maquina foi escrita
// à mão mas NÃO foi aplicada ao banco de dev (regra do projeto). Este
// arquivo só passa depois que alguém aplicar essa migration.
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.maquinaBordado.deleteMany({ where: { graficaId } });
    await prisma.maquinaTempo.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarGrafica() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Carregar Bordado Tempo ${s}`, slug: `teste-carregar-bordado-tempo-${s}` },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { grafica, s };
}

describe(
  "carregarContextoPrecificacao — BORDADO (achado A4)",
  () => {
    it(
      "lança MAQUINA_BORDADO_NAO_CONFIGURADA quando o produto não tem máquina vinculada",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Boné", nome: `Boné Bordado ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "BORDADO",
            precoCompra: 12,
            // maquinaBordadoId propositalmente ausente
          },
        });

        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toMatchObject({
          codigo: "MAQUINA_BORDADO_NAO_CONFIGURADA",
        });
        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toBeInstanceOf(
          ErroPrecificacao
        );
      },
      TIMEOUT_MS
    );

    it(
      "caminho feliz: carrega custoSubstratoPorPeca (do precoCompra) e os parâmetros da máquina vinculada",
      async () => {
        const { grafica, s } = await criarGrafica();
        const maquina = await prisma.maquinaBordado.create({
          data: {
            graficaId: grafica.id,
            nome: `Tajima 6 cabeças ${s}`,
            custoPorMilPontos: 0.75,
            custoMatrizDigitalizacao: 20,
            cabecas: 6,
            custoMinimo: 30,
          },
        });
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Boné", nome: `Boné Bordado ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "BORDADO",
            precoCompra: 12,
            maquinaBordadoId: maquina.id,
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.bordado).toMatchObject({ custoSubstratoPorPeca: 12 });
        expect(contexto.parametrosMaquinaBordado).toMatchObject({
          custoPorMilPontos: 0.75,
          custoMatrizDigitalizacao: 20,
          custoMinimo: 30,
        });
        expect(contexto.maquinaBordadoUsada).toMatchObject({ id: maquina.id, nome: maquina.nome });
      },
      TIMEOUT_MS
    );
  }
);

describe(
  "carregarContextoPrecificacao — TEMPO_MAQUINA (achado A6)",
  () => {
    it(
      "lança MAQUINA_TEMPO_NAO_CONFIGURADA quando o produto não tem máquina vinculada",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Placa", nome: `Placa Cortada ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "TEMPO_MAQUINA",
            // maquinaTempoId propositalmente ausente
          },
        });

        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toMatchObject({
          codigo: "MAQUINA_TEMPO_NAO_CONFIGURADA",
        });
      },
      TIMEOUT_MS
    );

    it(
      "caminho feliz: carrega os parâmetros da máquina vinculada (custoHoraMaq/custoSetupPorJob/custoPorMetroCorte)",
      async () => {
        const { grafica, s } = await criarGrafica();
        const maquina = await prisma.maquinaTempo.create({
          data: {
            graficaId: grafica.id,
            nome: `Router CNC ${s}`,
            custoHoraMaq: 60,
            custoSetupPorJob: 15,
            custoMinimo: 20,
            custoPorMetroCorte: 2,
          },
        });
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Placa", nome: `Placa Cortada ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "TEMPO_MAQUINA",
            maquinaTempoId: maquina.id,
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.tempoMaquina).toEqual({});
        expect(contexto.parametrosMaquinaTempo).toMatchObject({
          custoHoraMaq: 60,
          custoSetupPorJob: 15,
          custoMinimo: 20,
          custoPorMetroCorte: 2,
        });
        expect(contexto.maquinaTempoUsada).toMatchObject({ id: maquina.id, nome: maquina.nome });
      },
      TIMEOUT_MS
    );
  }
);
