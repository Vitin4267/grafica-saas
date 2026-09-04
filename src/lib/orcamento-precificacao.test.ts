import { describe, it, expect, afterEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { calcularItemOrcamento } from "./orcamento-precificacao";

// Só cobre o modelo SIMPLES: é o único caminho que não toca o banco
// (M2/OFFSET chamam carregarContextoPrecificacao, que precisa de Prisma —
// fora do escopo de teste puro deste projeto). graficaId é um valor
// qualquer, nunca usado nesse caminho.
const ITEM_SIMPLES = {
  id: "item-1",
  modeloCalculo: "SIMPLES" as const,
  precoVenda: 10 as unknown as Prisma.Decimal,
};

describe("calcularItemOrcamento — modelo SIMPLES (achados da auditoria de 2026-07-23)", () => {
  it("aceita quantidade inteira positiva normal", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 3,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.precoTotal).toBe("30");
    }
  });

  it("rejeita quantidade fracionária (editarOrcamento/adicionarItemOrcamento liam isso sem zod)", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 2.5,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidade Infinity (Number('Infinity') ou Number('1e400') passavam pelo !quantidade || quantidade<=0 antigo)", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: Infinity,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidade zero", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 0,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidade negativa", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: -3,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidade NaN", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: NaN,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita altura infinita mesmo com largura válida", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: 10,
      alturaCm: Infinity,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita largura negativa", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: -10,
      alturaCm: 10,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  // Guardas do motor de clichê de etiqueta / faca / frete — mesmo raciocínio
  // das guardas de quantidade/largura acima: editarOrcamento/
  // adicionarItemOrcamento leem esses campos direto do FormData, sem zod.
  // ITEM_SIMPLES nem chega a tocar essas guardas (elas rodam antes do branch
  // SIMPLES/M2/OFFSET), então serve igual pros três casos abaixo.
  it("rejeita quantidadeCores fracionária", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: 1.5,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidadeCores menor que 1", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: 0,
      custoFaca: null,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita custoFaca negativo", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: -1,
      custoFrete: null,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita custoFrete negativo", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SIMPLES, "grafica-1", {
      quantidade: 1,
      larguraCm: null,
      alturaCm: null,
      corFrente: null,
      corVerso: null,
      acabamentoIds: [],
      papelId: null,
      quantidadeCores: null,
      custoFaca: null,
      custoFrete: -1,
      numeroCoresFlexo: null,
      numeroCliques: null,
      numeroSetups: null,
      numeroPontos: null,
      tempoEstimadoMin: null,
      metrosCorte: null,
      horasEstimadas: null,
      custoAquisicaoUnitario: null,
      materialFornecidoPeloCliente: false,
      margemLucroOverride: null,
    });
    expect(resultado.ok).toBe(false);
  });
});

// Guardas novas de DIGITAL/setup-por-peça (Feature A) — todas rodam ANTES do
// branch SIMPLES/carregarContextoPrecificacao, então não tocam o banco (mesma
// razão pela qual os testes de ITEM_SIMPLES acima também não tocam), apesar
// de referenciar itens que não existem de verdade — a guarda retorna antes de
// qualquer query.
const ITEM_DIGITAL = {
  id: "item-digital-1",
  modeloCalculo: "DIGITAL" as const,
  precoVenda: null as unknown as Prisma.Decimal | null,
};
const ITEM_SERIGRAFIA = {
  id: "item-serigrafia-1",
  modeloCalculo: "SERIGRAFIA" as const,
  precoVenda: null as unknown as Prisma.Decimal | null,
};
const ITEM_SUBLIMACAO = {
  id: "item-sublimacao-1",
  modeloCalculo: "SUBLIMACAO" as const,
  precoVenda: null as unknown as Prisma.Decimal | null,
};
const ITEM_ESTAMPAGEM = {
  id: "item-estampagem-1",
  modeloCalculo: "ESTAMPAGEM_QUENTE" as const,
  precoVenda: null as unknown as Prisma.Decimal | null,
};

function dadosBase(overrides: Partial<Parameters<typeof calcularItemOrcamento>[2]>) {
  return {
    quantidade: 10,
    larguraCm: null,
    alturaCm: null,
    corFrente: null,
    corVerso: null,
    acabamentoIds: [],
    papelId: null,
    quantidadeCores: null,
    custoFaca: null,
    custoFrete: null,
    numeroCoresFlexo: null,
    numeroCliques: null,
    numeroSetups: null,
    numeroPontos: null,
    tempoEstimadoMin: null,
    metrosCorte: null,
    horasEstimadas: null,
    custoAquisicaoUnitario: null,
    materialFornecidoPeloCliente: false,
    margemLucroOverride: null,
    ...overrides,
  };
}

describe("calcularItemOrcamento — guardas novas (DIGITAL / setup-por-peça)", () => {
  it("DIGITAL: rejeita numeroCliques fracionário", async () => {
    const resultado = await calcularItemOrcamento(
      ITEM_DIGITAL,
      "grafica-1",
      dadosBase({ numeroCliques: 1.5 })
    );
    expect(resultado.ok).toBe(false);
  });

  it("DIGITAL: rejeita numeroCliques menor que 1", async () => {
    const resultado = await calcularItemOrcamento(
      ITEM_DIGITAL,
      "grafica-1",
      dadosBase({ numeroCliques: 0 })
    );
    expect(resultado.ok).toBe(false);
  });

  it("SERIGRAFIA: rejeita numeroSetups ausente (obrigatório, sem default)", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SERIGRAFIA, "grafica-1", dadosBase({}));
    expect(resultado.ok).toBe(false);
  });

  it("SERIGRAFIA: rejeita numeroSetups menor que 1", async () => {
    const resultado = await calcularItemOrcamento(
      ITEM_SERIGRAFIA,
      "grafica-1",
      dadosBase({ numeroSetups: 0 })
    );
    expect(resultado.ok).toBe(false);
  });

  it("SUBLIMACAO: rejeita numeroSetups ausente", async () => {
    const resultado = await calcularItemOrcamento(ITEM_SUBLIMACAO, "grafica-1", dadosBase({}));
    expect(resultado.ok).toBe(false);
  });

  it("ESTAMPAGEM_QUENTE: rejeita numeroSetups ausente", async () => {
    const resultado = await calcularItemOrcamento(ITEM_ESTAMPAGEM, "grafica-1", dadosBase({}));
    expect(resultado.ok).toBe(false);
  });

  it("DIGITAL/setup-por-peça: quantidade/largura/altura continuam validadas mesmo sem exigir dimensão", async () => {
    // larguraCm negativo deve ser rejeitado mesmo pra um modelo cuja dimensão
    // é opcional — "opcional" não é "sem validação quando presente".
    const resultado = await calcularItemOrcamento(
      ITEM_DIGITAL,
      "grafica-1",
      dadosBase({ larguraCm: -10, alturaCm: 10 })
    );
    expect(resultado.ok).toBe(false);
  });
});

// Achado B7 (correção de regressão do A2, 2026-08-24) — "material fornecido
// pelo cliente": DIGITAL e os 4 modelos de setup-por-peça cobram
// ContextoDigital/ContextoSetupPorPeca.custoSubstratoPorPeca a partir de
// ItemGrafica.precoCompra (ver carregar.ts) — quando o item do orçamento
// marca materialFornecidoPeloCliente=true, o motor precisa zerar esse
// substrato (o cliente já trouxe a peça, a gráfica só aplica a estampa).
// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/pricing/carregar.test.ts) — precisa passar por
// carregarContextoPrecificacao de verdade pra cobrir a mutação de
// contexto.digital/contexto.setupPorPeca em orcamento-precificacao.ts, não só
// a função pura precificar().
describe("calcularItemOrcamento — materialFornecidoPeloCliente (achado B7)", () => {
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
      data: { nome: `Teste Material Fornecido ${s}`, slug: `teste-material-fornecido-${s}` },
    });
    graficaIdsParaLimpar.push(grafica.id);
    return { grafica, s };
  }

  // Achado N4 — o motor Digital agora exige um papel (matéria-prima) com
  // FormatoFolha cadastrado, escolhido NO ORÇAMENTO (dados.papelId), pra
  // resolver a imposição. Peça 10×10cm numa folha 50×40cm sem sangria/
  // margem/gap (zerados no fixture de largura/altura abaixo) cabe 5×4=20 —
  // números redondos só pra facilitar a conta manual dos testes.
  async function criarPapelDigital(graficaId: string, s: string, precoCompraPorFolha: number) {
    const catalogoPapel = await prisma.itemCatalogo.create({
      data: { graficaId, tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: `Papel Digital ${s}` },
    });
    return prisma.itemGrafica.create({
      data: {
        graficaId,
        itemCatalogoId: catalogoPapel.id,
        modeloCalculo: "SIMPLES",
        precoCompra: precoCompraPorFolha,
        formatosFolha: { create: [{ nome: `Folha 50x40 ${s}`, larguraFolha: 0.5, alturaFolha: 0.4 }] },
      },
    });
  }

  it(
    "DIGITAL: materialFornecidoPeloCliente=true zera custoSubstrato no breakdown",
    async () => {
      const { grafica, s } = await criarGrafica();
      const impressora = await prisma.impressoraDigital.create({
        data: { graficaId: grafica.id, nome: `HP Indigo ${s}`, custoPorClique: 0.08 },
      });
      // substrato caro de propósito (por FOLHA agora, achado N4), pra
      // diferença ficar óbvia
      const papel = await criarPapelDigital(grafica.id, s, 12);
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta Digital ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: {
          graficaId: grafica.id,
          itemCatalogoId: catalogo.id,
          modeloCalculo: "DIGITAL",
          impressoraDigitalId: impressora.id,
        },
      });

      const dadosSemFlag = dadosBase({
        larguraCm: 10,
        alturaCm: 10,
        papelId: papel.id,
        materialFornecidoPeloCliente: false,
      });
      const dadosComFlag = dadosBase({
        larguraCm: 10,
        alturaCm: 10,
        papelId: papel.id,
        materialFornecidoPeloCliente: true,
      });

      const resultadoSemFlag = await calcularItemOrcamento(produto, grafica.id, dadosSemFlag);
      const resultadoComFlag = await calcularItemOrcamento(produto, grafica.id, dadosComFlag);

      expect(resultadoSemFlag.ok).toBe(true);
      expect(resultadoComFlag.ok).toBe(true);
      if (resultadoSemFlag.ok && resultadoComFlag.ok) {
        // false (default) — comportamento de hoje, sem regressão: substrato
        // cobrado normalmente (custoPorPeca > 0 pro precoCompra=12 acima).
        const metricasSemFlag = (resultadoSemFlag.breakdown as { metricas: { custoSubstrato: number } })
          .metricas;
        expect(metricasSemFlag.custoSubstrato).toBeGreaterThan(0);
        expect(resultadoSemFlag.materialFornecidoPeloCliente).toBe(false);

        // true — cliente já trouxe a peça: substrato efetivo é 0.
        const metricasComFlag = (resultadoComFlag.breakdown as { metricas: { custoSubstrato: number } })
          .metricas;
        expect(metricasComFlag.custoSubstrato).toBe(0);
        expect(resultadoComFlag.materialFornecidoPeloCliente).toBe(true);

        // Preço final reflete a diferença — nunca cobra a peça que a gráfica
        // não comprou.
        expect(Number(resultadoComFlag.precoTotal)).toBeLessThan(Number(resultadoSemFlag.precoTotal));
      }
    },
    TIMEOUT_MS
  );

  it(
    "SERIGRAFIA (setup-por-peça): materialFornecidoPeloCliente=true zera custoSubstrato no breakdown",
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
          precoCompra: 15,
          maquinaSetupPorPecaId: maquina.id,
        },
      });

      const dadosSemFlag = dadosBase({ numeroSetups: 1, materialFornecidoPeloCliente: false });
      const dadosComFlag = dadosBase({ numeroSetups: 1, materialFornecidoPeloCliente: true });

      const resultadoSemFlag = await calcularItemOrcamento(produto, grafica.id, dadosSemFlag);
      const resultadoComFlag = await calcularItemOrcamento(produto, grafica.id, dadosComFlag);

      expect(resultadoSemFlag.ok).toBe(true);
      expect(resultadoComFlag.ok).toBe(true);
      if (resultadoSemFlag.ok && resultadoComFlag.ok) {
        const metricasSemFlag = (resultadoSemFlag.breakdown as { metricas: { custoSubstrato: number } })
          .metricas;
        expect(metricasSemFlag.custoSubstrato).toBeGreaterThan(0);

        const metricasComFlag = (resultadoComFlag.breakdown as { metricas: { custoSubstrato: number } })
          .metricas;
        expect(metricasComFlag.custoSubstrato).toBe(0);

        expect(Number(resultadoComFlag.precoTotal)).toBeLessThan(Number(resultadoSemFlag.precoTotal));
      }
    },
    TIMEOUT_MS
  );
});

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão do describe acima) — cobre a implementação do achado A7 da
// auditoria de abrangência (2026-08-24): Cliente.margemPadraoOverride
// precisa chegar até ContextoPrecificacao.margemLucroOverride (gancho que já
// existia dormente em comporPreco/precificar.ts) e mudar o preço final de
// verdade, não só compilar.
describe("calcularItemOrcamento — margemLucroOverride (achado A7)", () => {
  const TIMEOUT_MS = 30_000;
  const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const graficaIdsParaLimpar: string[] = [];

  afterEach(async () => {
    for (const graficaId of graficaIdsParaLimpar) {
      await prisma.itemGrafica.deleteMany({ where: { graficaId } });
      await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
      await prisma.impressoraDigital.deleteMany({ where: { graficaId } });
      await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
      await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
    }
    graficaIdsParaLimpar.length = 0;
  }, TIMEOUT_MS);

  it(
    "DIGITAL: margemLucroOverride do cliente substitui a margemPadrao da gráfica no preço final",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Margem Cliente ${s}`, slug: `teste-margem-cliente-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      // margemPadrao alta de propósito (40%) pra sobrar espaço claro abaixo
      // dela — o override do cliente (5%) precisa gerar um preço MENOR.
      await prisma.parametrosGrafica.create({
        data: { graficaId: grafica.id, margemPadrao: 0.4 },
      });
      const impressora = await prisma.impressoraDigital.create({
        data: { graficaId: grafica.id, nome: `HP Indigo ${s}`, custoPorClique: 0.08 },
      });
      // Achado N4 — papel (matéria-prima) com FormatoFolha, escolhido no
      // orçamento; peça 10×10cm numa folha 50×40cm sem sangria/margem/gap
      // cabe 5×4=20 por folha.
      const catalogoPapel = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: `Papel Digital ${s}` },
      });
      const papel = await prisma.itemGrafica.create({
        data: {
          graficaId: grafica.id,
          itemCatalogoId: catalogoPapel.id,
          modeloCalculo: "SIMPLES",
          precoCompra: 1,
          formatosFolha: { create: [{ nome: `Folha 50x40 ${s}`, larguraFolha: 0.5, alturaFolha: 0.4 }] },
        },
      });
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Digital ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: {
          graficaId: grafica.id,
          itemCatalogoId: catalogo.id,
          modeloCalculo: "DIGITAL",
          impressoraDigitalId: impressora.id,
        },
      });

      const dadosSemOverride = dadosBase({
        larguraCm: 10,
        alturaCm: 10,
        papelId: papel.id,
        margemLucroOverride: null,
      });
      const dadosComOverride = dadosBase({
        larguraCm: 10,
        alturaCm: 10,
        papelId: papel.id,
        margemLucroOverride: 0.05,
      });

      const resultadoSemOverride = await calcularItemOrcamento(produto, grafica.id, dadosSemOverride);
      const resultadoComOverride = await calcularItemOrcamento(produto, grafica.id, dadosComOverride);

      expect(resultadoSemOverride.ok).toBe(true);
      expect(resultadoComOverride.ok).toBe(true);
      if (resultadoSemOverride.ok && resultadoComOverride.ok) {
        // null (default) — comportamento de hoje: usa margemPadrao (40%) da
        // gráfica, sem regressão pra cliente sem override cadastrado.
        // Com override (5%): preço final bem mais baixo — a margem do
        // cliente venceu a da gráfica.
        expect(Number(resultadoComOverride.precoTotal)).toBeLessThan(Number(resultadoSemOverride.precoTotal));
      }
    },
    TIMEOUT_MS
  );
});

// Teste de INTEGRAÇÃO de verdade (mesmo padrão dos describes acima) — cobre o
// guard estendido de "custo R$0 silencioso" pra METRO_LINEAR/HORA (achado A1
// da auditoria de abrangência): um item DIGITAL/setup-por-peça (sem nesting,
// largura/altura opcionais) que tenha um acabamento METRO_LINEAR ou HORA
// anexado precisa ser bloqueado ANTES do motor, com mensagem amigável, em vez
// de calcular perimetroOuEmenda/horasEstimadas ausente = 0 em silêncio (ver
// ctxAcabamentoExtra em src/lib/pricing/precificar.ts).
describe("calcularItemOrcamento — guard METRO_LINEAR/HORA (achado A1)", () => {
  const TIMEOUT_MS = 30_000;
  const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const graficaIdsParaLimpar: string[] = [];

  afterEach(async () => {
    for (const graficaId of graficaIdsParaLimpar) {
      await prisma.itemGrafica.deleteMany({ where: { graficaId } });
      await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
      await prisma.impressoraDigital.deleteMany({ where: { graficaId } });
      await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
      await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
    }
    graficaIdsParaLimpar.length = 0;
  }, TIMEOUT_MS);

  async function criarProdutoDigitalComAcabamento(baseCobranca: "METRO_LINEAR" | "HORA") {
    const s = sufixo();
    const grafica = await prisma.grafica.create({
      data: { nome: `Teste Guard Acabamento ${s}`, slug: `teste-guard-acabamento-${s}` },
    });
    graficaIdsParaLimpar.push(grafica.id);
    const impressora = await prisma.impressoraDigital.create({
      data: { graficaId: grafica.id, nome: `HP Indigo ${s}`, custoPorClique: 0.08 },
    });
    const catalogoProduto = await prisma.itemCatalogo.create({
      data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta Digital ${s}` },
    });
    const produto = await prisma.itemGrafica.create({
      data: {
        graficaId: grafica.id,
        itemCatalogoId: catalogoProduto.id,
        modeloCalculo: "DIGITAL",
        precoCompra: 5,
        impressoraDigitalId: impressora.id,
      },
    });
    const catalogoAcabamento = await prisma.itemCatalogo.create({
      data: { graficaId: grafica.id, tipo: "SERVICO", categoria: "Acabamento", nome: `Instalação ${s}` },
    });
    const acabamento = await prisma.itemGrafica.create({
      data: {
        graficaId: grafica.id,
        itemCatalogoId: catalogoAcabamento.id,
        precoCompra: 50,
        configuracaoAcabamento: {
          create: { baseCobranca, estagio: "POS_REFILE", custoSetup: 0, custoMinimo: 0 },
        },
      },
    });
    // Achado N4 — o motor Digital agora exige um papel (matéria-prima) com
    // FormatoFolha cadastrado, escolhido NO ORÇAMENTO (dados.papelId), pra
    // resolver a imposição. Folha bem maior que a peça (100×200cm) só pra
    // garantir que cabe 1 vez (nUp≥1) sem precisar calibrar a conta — estes
    // testes cobrem o guard de METRO_LINEAR/HORA, não a imposição em si.
    const catalogoPapel = await prisma.itemCatalogo.create({
      data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papéis", nome: `Papel Digital ${s}` },
    });
    const papel = await prisma.itemGrafica.create({
      data: {
        graficaId: grafica.id,
        itemCatalogoId: catalogoPapel.id,
        modeloCalculo: "SIMPLES",
        precoCompra: 10,
        formatosFolha: { create: [{ nome: `Folha 3x3 ${s}`, larguraFolha: 3, alturaFolha: 3 }] },
      },
    });
    return { produto, acabamento, papel };
  }

  it(
    "DIGITAL com acabamento METRO_LINEAR anexado e sem largura/altura: bloqueia com mensagem amigável (não custa R$0 em silêncio)",
    async () => {
      const { produto, acabamento } = await criarProdutoDigitalComAcabamento("METRO_LINEAR");

      const resultado = await calcularItemOrcamento(
        produto,
        produto.graficaId,
        dadosBase({ acabamentoIds: [acabamento.id] })
      );

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.mensagem).toMatch(/largura e altura/i);
      }
    },
    TIMEOUT_MS
  );

  it(
    "DIGITAL com acabamento METRO_LINEAR anexado e largura/altura informadas: calcula normalmente",
    async () => {
      const { produto, acabamento, papel } = await criarProdutoDigitalComAcabamento("METRO_LINEAR");

      const resultado = await calcularItemOrcamento(
        produto,
        produto.graficaId,
        dadosBase({ acabamentoIds: [acabamento.id], larguraCm: 100, alturaCm: 200, papelId: papel.id })
      );

      expect(resultado.ok).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "DIGITAL com acabamento HORA anexado e sem horasEstimadas: bloqueia com mensagem amigável",
    async () => {
      const { produto, acabamento, papel } = await criarProdutoDigitalComAcabamento("HORA");

      const resultado = await calcularItemOrcamento(
        produto,
        produto.graficaId,
        dadosBase({ acabamentoIds: [acabamento.id], larguraCm: 100, alturaCm: 200, papelId: papel.id })
      );

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.mensagem).toMatch(/hora/i);
      }
    },
    TIMEOUT_MS
  );

  it(
    "DIGITAL com acabamento HORA anexado e horasEstimadas preenchido: calcula normalmente",
    async () => {
      const { produto, acabamento, papel } = await criarProdutoDigitalComAcabamento("HORA");

      const resultado = await calcularItemOrcamento(
        produto,
        produto.graficaId,
        dadosBase({
          acabamentoIds: [acabamento.id],
          larguraCm: 100,
          alturaCm: 200,
          horasEstimadas: 2,
          papelId: papel.id,
        })
      );

      expect(resultado.ok).toBe(true);
    },
    TIMEOUT_MS
  );
});
