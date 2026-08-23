import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { carregarContextoPrecificacao } from "./carregar";
import { ErroPrecificacao } from "./erros";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/pedido-aprovacao.test.ts) — cobre as 2 branches
// novas de carregarContextoPrecificacao (Feature A): DIGITAL e os 3 modelos
// de setup-por-peça (testados via SERIGRAFIA, já que os 3 compartilham o
// mesmo branch no código). Cada cenário cobre "máquina não configurada"
// (erro) e "caminho feliz" (contexto carregado corretamente do banco).
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.impressoraDigital.deleteMany({ where: { graficaId } });
    await prisma.maquinaSetupPorPeca.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarGrafica() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Carregar Contexto ${s}`, slug: `teste-carregar-contexto-${s}` },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { grafica, s };
}

describe(
  "carregarContextoPrecificacao — DIGITAL",
  () => {
    it(
      "lança IMPRESSORA_DIGITAL_NAO_CONFIGURADA quando o produto não tem impressora vinculada",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Digital ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "DIGITAL",
            precoCompra: 0.3,
            // impressoraDigitalId propositalmente ausente
          },
        });

        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toMatchObject({
          codigo: "IMPRESSORA_DIGITAL_NAO_CONFIGURADA",
        });
        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toBeInstanceOf(
          ErroPrecificacao
        );
      },
      TIMEOUT_MS
    );

    it(
      "caminho feliz: carrega custoSubstratoPorPeca (do precoCompra) e os parâmetros da impressora vinculada",
      async () => {
        const { grafica, s } = await criarGrafica();
        const impressora = await prisma.impressoraDigital.create({
          data: { graficaId: grafica.id, nome: `HP Indigo ${s}`, custoPorClique: 0.08 },
        });
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Digital ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "DIGITAL",
            precoCompra: 0.3,
            impressoraDigitalId: impressora.id,
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.digital).toMatchObject({ custoSubstratoPorPeca: 0.3 });
        expect(contexto.parametrosImpressoraDigital).toMatchObject({ custoPorClique: 0.08 });
        expect(contexto.impressoraDigitalUsada).toMatchObject({ id: impressora.id, nome: impressora.nome });
      },
      TIMEOUT_MS
    );
  }
);

describe(
  "carregarContextoPrecificacao — setup-por-peça (SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE)",
  () => {
    it(
      "lança MAQUINA_SETUP_POR_PECA_NAO_CONFIGURADA quando o produto não tem máquina vinculada",
      async () => {
        const { grafica, s } = await criarGrafica();
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta Serigrafia ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "SERIGRAFIA",
            // maquinaSetupPorPecaId propositalmente ausente
          },
        });

        await expect(carregarContextoPrecificacao(produto.id, grafica.id)).rejects.toMatchObject({
          codigo: "MAQUINA_SETUP_POR_PECA_NAO_CONFIGURADA",
        });
      },
      TIMEOUT_MS
    );

    it(
      "caminho feliz: carrega os parâmetros da máquina vinculada (custoPorSetup/custoPorPeca/custoMinimo)",
      async () => {
        const { grafica, s } = await criarGrafica();
        const maquina = await prisma.maquinaSetupPorPeca.create({
          data: {
            graficaId: grafica.id,
            nome: `Carrossel 6 cores ${s}`,
            tipoProcesso: "SERIGRAFIA",
            custoPorSetup: 80,
            custoPorPeca: 3.5,
            custoMinimo: 150,
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
            maquinaSetupPorPecaId: maquina.id,
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.parametrosMaquinaSetupPorPeca).toMatchObject({
          custoPorSetup: 80,
          custoPorPeca: 3.5,
          custoMinimo: 150,
        });
        expect(contexto.maquinaSetupPorPecaUsada).toMatchObject({ id: maquina.id, nome: maquina.nome });
      },
      TIMEOUT_MS
    );

    it(
      "SUBLIMACAO e ESTAMPAGEM_QUENTE também carregam pelo mesmo branch (não só SERIGRAFIA)",
      async () => {
        const { grafica, s } = await criarGrafica();
        const maquina = await prisma.maquinaSetupPorPeca.create({
          data: {
            graficaId: grafica.id,
            nome: `Prensa térmica ${s}`,
            tipoProcesso: "SUBLIMACAO",
            custoPorSetup: 10,
            custoPorPeca: 2,
            custoMinimo: 40,
          },
        });
        const catalogo = await prisma.itemCatalogo.create({
          data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Caneca", nome: `Caneca Sublimação ${s}` },
        });
        const produto = await prisma.itemGrafica.create({
          data: {
            graficaId: grafica.id,
            itemCatalogoId: catalogo.id,
            modeloCalculo: "SUBLIMACAO",
            maquinaSetupPorPecaId: maquina.id,
          },
        });

        const contexto = await carregarContextoPrecificacao(produto.id, grafica.id);

        expect(contexto.parametrosMaquinaSetupPorPeca).toMatchObject({ custoPorSetup: 10, custoPorPeca: 2 });
      },
      TIMEOUT_MS
    );
  }
);
