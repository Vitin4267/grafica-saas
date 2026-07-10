import { describe, expect, it } from "vitest";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type { ParametrosTenant } from "../tipos";

// Fixture de parâmetros de tenant — números plausíveis, não "oficiais" de mercado.
// O que importa nos testes é o COMPORTAMENTO relativo (qual bobina/folha vence,
// como o preço por milheiro cai com a tiragem), não bater centavo com uma tabela real.
const PARAMS: ParametrosTenant = {
  overheadPercent: 0.15,
  margemPadrao: 0.2,
  impostoPercent: 0.06,
  comissaoPercent: 0,
  taxaFinanceiraPercent: 0,
  pedidoMinimo: 15,
  incrementoArredondamento: 0.1,

  custoHoraMaq: 120,
  torres: 4,
  custoChapa: 25,
  folhasAcerto: 150,
  tempoAcertoH: 0.5,
  custoMilheiroRod: 40,
  rodagemMinima: 30,
  perdaPercentPadrao: 0.03,

  margemSegurancaPadrao: 0.02,
  gapPecasPadrao: 0.008,
};

describe("golden #1 — banner 0,80×1,20m escolhe a bobina mais barata (nesting)", () => {
  it("escolhe a bobina de 1,00m (menor área faturável) e não a de 1,20 nem 1,50", () => {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "banner-lona",
      modeloCalculo: "M2",
      viraFolha: false,
      parametros: PARAMS,
      m2: {
        bobinas: [
          { id: "bobina-1.00", larguraNominal: 1.0, refile: 0.02 },
          { id: "bobina-1.20", larguraNominal: 1.2, refile: 0.02 },
          { id: "bobina-1.50", larguraNominal: 1.5, refile: 0.02 },
        ],
        custoM2Material: 18.5,
        custoImpressaoM2: 6,
        areaMinimaFaturavel: 0.25,
      },
    };

    const pedido: PedidoPrecificacao = {
      tipo: "M2",
      pedido: { larguraM: 0.8, alturaM: 1.2, quantidade: 1 },
      acabamentos: [],
    };

    const resultado = precificar(pedido, contexto);

    // Bobina de 1,00m vence: com w'=0,84/h'=1,24 e W_util=0,96, só cabe 1 peça
    // por faixa colocando o lado de 0,84 atravessado — a de 1,20m desperdiça mais
    // largura (mesma 1 peça por faixa, rolo mais largo) e a de 1,50m só vence se
    // o algoritmo tentar a orientação girada, o que ainda perde para a de 1,00m.
    expect(resultado.metricas.bobinaEscolhida).toMatchObject({ id: "bobina-1.00" });
    expect(resultado.metricas.pecasPorFaixa).toBe(1);
    expect(resultado.metricas.numFaixas).toBe(1);
    // área faturável = largura nominal cheia × comprimento consumido (1,00 × 1,248)
    expect(resultado.metricas.areaFaturavel as number).toBeCloseTo(1.248, 3);
  });
});

describe("golden #2 — cartão 9×5cm 4/4 com BOPP: preço por milheiro cai com a tiragem", () => {
  function precificarCartao(quantidade: number) {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "cartao-visita",
      modeloCalculo: "OFFSET",
      viraFolha: false,
      parametros: PARAMS,
      offset: {
        folhas: [{ id: "folha-66x96", nome: "Fechada 66x96", larguraFolha: 0.66, alturaFolha: 0.96 }],
        gramaturaGm2: 300,
        precoPorKg: 8.5,
        viraFolha: false,
      },
    };

    const pedido: PedidoPrecificacao = {
      tipo: "OFFSET",
      pedido: { larguraM: 0.09, alturaM: 0.05, quantidade, corFrente: 4, corVerso: 4 },
      acabamentos: [
        {
          itemGraficaId: "bopp-fosco",
          nome: "Laminação BOPP Fosca",
          baseCobranca: "FOLHA_IMPRESSA",
          estagio: "PRE_REFILE",
          custoUnitario: 0.05,
          custoSetup: 20,
          custoMinimo: 10,
        },
      ],
    };

    return precificar(pedido, contexto);
  }

  it("nUp e entradas batem com o cálculo manual de imposição", () => {
    const r1000 = precificarCartao(1000);
    expect(r1000.metricas.nUp).toBe(96); // floor(0.63/0.098) × floor(0.942/0.058) = 6×16
    expect(r1000.metricas.entradas).toBe(2); // ceil(4/4) + ceil(4/4)
    expect(r1000.metricas.folhasTotais).toBe(312); // 11 boas + 1 perda + 300 de acerto
  });

  it("preço por milheiro em Q=10.000 é nitidamente menor que em Q=1.000 (diluição de chapa/acerto)", () => {
    const r1000 = precificarCartao(1000);
    const r10000 = precificarCartao(10000);

    const precoPorMilheiro1000 = r1000.precoFinal.div(1000 / 1000);
    const precoPorMilheiro10000 = r10000.precoFinal.div(10000 / 1000);

    expect(precoPorMilheiro10000.lt(precoPorMilheiro1000)).toBe(true);
    // a diferença deve ser de ordem de grandeza, não só "um pouco menor" —
    // senão a diluição de chapa/acerto não está sendo capturada de verdade.
    expect(precoPorMilheiro1000.div(precoPorMilheiro10000).toNumber()).toBeGreaterThan(3);
  });
});

describe("golden #3 — adesivo 3×3cm Q=10 aciona o piso de pedidoMinimo", () => {
  it("preço final é exatamente o pedidoMinimo configurado (custo real é irrisório)", () => {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "adesivo-pequeno",
      modeloCalculo: "M2",
      viraFolha: false,
      parametros: PARAMS,
      m2: {
        bobinas: [{ id: "bobina-1.00", larguraNominal: 1.0, refile: 0.02 }],
        custoM2Material: 18.5,
        custoImpressaoM2: 6,
        areaMinimaFaturavel: 0.05,
      },
    };

    const pedido: PedidoPrecificacao = {
      tipo: "M2",
      pedido: { larguraM: 0.03, alturaM: 0.03, quantidade: 10 },
      acabamentos: [],
    };

    const resultado = precificar(pedido, contexto);

    expect(resultado.precoFinal.toNumber()).toBeCloseTo(PARAMS.pedidoMinimo, 5);
  });
});

describe("golden #4 — lona 3,00×2,00m excede todas as bobinas cadastradas", () => {
  it("lança ErroPrecificacao PECA_EXCEDE_BOBINA em vez de calcular um preço errado", () => {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "banner-lona",
      modeloCalculo: "M2",
      viraFolha: false,
      parametros: PARAMS,
      m2: {
        bobinas: [
          { id: "bobina-1.00", larguraNominal: 1.0, refile: 0.02 },
          { id: "bobina-1.20", larguraNominal: 1.2, refile: 0.02 },
          { id: "bobina-1.50", larguraNominal: 1.5, refile: 0.02 },
        ],
        custoM2Material: 18.5,
        custoImpressaoM2: 6,
        areaMinimaFaturavel: 0.25,
      },
    };

    const pedido: PedidoPrecificacao = {
      tipo: "M2",
      pedido: { larguraM: 3.0, alturaM: 2.0, quantidade: 1 },
      acabamentos: [],
    };

    expect(() => precificar(pedido, contexto)).toThrow(ErroPrecificacao);
    try {
      precificar(pedido, contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PECA_EXCEDE_BOBINA");
    }
  });
});
