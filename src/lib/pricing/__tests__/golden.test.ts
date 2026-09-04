import { describe, expect, it } from "vitest";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type { ParametrosMaquinaFlexo, ParametrosPrensa, ParametrosTenant } from "../tipos";

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

  margemSegurancaPadrao: 0.02,
  gapPecasPadrao: 0.008,
};

// Fixture de parâmetros de uma prensa offset — usada só nos cenários OFFSET.
const PARAMS_PRENSA: ParametrosPrensa = {
  custoHoraMaq: 120,
  torres: 4,
  custoChapa: 25,
  folhasAcerto: 150,
  tempoAcertoH: 0.5,
  custoMilheiroRod: 40,
  rodagemMinima: 30,
  perdaPercentPadrao: 0.03,
};

// Fixture de parâmetros de uma máquina flexo — usada só no cenário FLEXOGRAFIA.
const PARAMS_MAQUINA_FLEXO: ParametrosMaquinaFlexo = {
  custoHoraMaq: 150,
  numeroEstacoesCores: 6,
  larguraMaquinaM: 0.5,
  passoCilindroM: 0.4,
  tempoAcertoH: 0.5,
  metrosAcerto: 20,
  custoMetroLinearRod: 0.8,
  rodagemMinima: 25,
  perdaPercentPadrao: 0.03,
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
      parametrosPrensa: PARAMS_PRENSA,
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

// Achado N3 da auditoria de abrangência — pedidoMinimo NÃO é mais um piso
// por ITEM (comporPreco não conhece mais esse campo, ver src/lib/pricing/
// compor.ts). O nome deste golden mudou de propósito: agora prova que um
// item pequeno sai com o preço CALCULADO, sem ser clampado ao pedidoMinimo
// do tenant — o piso de pedido virou uma responsabilidade de outra camada
// (aplicarPisoDoPedido, testado em compor.test.ts; aplicado de verdade num
// orçamento por recalcularTotalOrcamento, src/lib/orcamento-precificacao.ts).
describe("golden #3 — adesivo 3×3cm Q=10 NÃO é clampado ao pedidoMinimo no nível do item", () => {
  it("preço final do item reflete o custo calculado (bem abaixo de pedidoMinimo), não o piso do tenant", () => {
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

    // Bem menor que PARAMS.pedidoMinimo (15) — nada no motor de item clampa
    // mais o preço a esse valor. (areaMinimaFaturavel=0.05 do achado N18
    // ainda infla o custoBase — peça de 3×3cm é bem menor que 0,05m² — mas
    // isso não chega perto do piso de R$15 do pedido inteiro.)
    expect(resultado.precoFinal.toNumber()).toBeLessThan(PARAMS.pedidoMinimo);
    expect(resultado.precoFinal.toNumber()).toBeGreaterThan(0);
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

describe("golden #5 — rótulo flexo 8×5cm 3 cores: clichê fixo por cor/área, não escala com a tiragem", () => {
  function precificarRotulo(quantidade: number) {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "rotulo-flexo",
      modeloCalculo: "FLEXOGRAFIA",
      viraFolha: false,
      parametros: PARAMS,
      parametrosMaquinaFlexo: PARAMS_MAQUINA_FLEXO,
      flexografia: {
        bobinas: [{ id: "bobina-0.30", larguraNominal: 0.3, refile: 0.01 }],
        custoM2Material: 5,
      },
      clicheFlexo: { custoClichePorCm2: 1 },
    };

    const pedido: PedidoPrecificacao = {
      tipo: "FLEXOGRAFIA",
      pedido: { larguraM: 0.08, alturaM: 0.05, quantidade, numeroCores: 3 },
      acabamentos: [],
    };

    return precificar(pedido, contexto);
  }

  it("custo de clichê é IDÊNTICO em tiragens bem diferentes (por área×cor, não por quantidade)", () => {
    // Rótulo 8×5cm = 40cm². 3 cores × R$1,00/cm² × 40cm² = R$120.
    const resultadoPequeno = precificarRotulo(100);
    const resultadoGrande = precificarRotulo(50_000);

    expect(resultadoPequeno.detalhes.cliche.toNumber()).toBe(120);
    expect(resultadoGrande.detalhes.cliche.toNumber()).toBe(120);
  });

  it("expõe nUp/entradas/bobinaEscolhida nas métricas, ponta a ponta via precificar()", () => {
    const resultado = precificarRotulo(100);

    expect(resultado.metricas.bobinaEscolhida).toMatchObject({ id: "bobina-0.30" });
    expect(resultado.metricas.entradas).toBe(1); // ceil(3/6)
    expect(resultado.metricas.maquinaFlexoUsada).toBeNull(); // não informado neste cenário
  });
});

describe("golden #6 — cartão digital Q=500: imposição por folha (achado N4), custo por clique + substrato POR FOLHA", () => {
  it("preço final bate com o cálculo manual (nUp/numeroFolhas -> custoCliques + custoSubstrato -> composição padrão)", () => {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "cartao-digital",
      modeloCalculo: "DIGITAL",
      viraFolha: false,
      parametros: PARAMS,
      // Folha 0,5 × 0,4m, peça 0,1 × 0,1m, sem sangria/margem/gap (zerados no
      // pedido abaixo) — nUp = floor(0.5/0.1) × floor(0.4/0.1) = 5 × 4 = 20.
      digital: {
        folhas: [{ id: "folha-1", nome: "Folha 50x40", larguraFolha: 0.5, alturaFolha: 0.4 }],
        custoPorFolha: 6,
      },
      parametrosImpressoraDigital: { custoPorClique: 0.08 },
      impressoraDigitalUsada: { id: "impressora-1", nome: "HP Indigo 12000" },
    };

    const pedido: PedidoPrecificacao = {
      tipo: "DIGITAL",
      pedido: {
        larguraM: 0.1,
        alturaM: 0.1,
        quantidade: 500,
        sangria: 0,
        margemLateral: 0,
        gapPecas: 0,
      }, // sem numeroCliques -> default 1 por folha
      acabamentos: [],
    };

    const resultado = precificar(pedido, contexto);

    // nUp = 20 -> numeroFolhas = ceil(500/20) = 25 (não mais 500!).
    // custoCliques = 25 × 1 × 0,08 = 2; custoSubstrato = 25 × 6 = 150;
    // custoBase = 152 -> custoTotal = 152 × 1,15 = 174,8 -> precoBruto =
    // 174,8 / (1 - 0,26) = 236,2162...  -> arredonda pra cima no incremento
    // de 0,10 -> 236,30 -> precoUnitario = 236,30/500 = 0,4726 -> 0,47 (2
    // casas) -> precoFinal = 0,47 × 500 = 235,00.
    expect(resultado.metricas.nUp).toBe(20);
    expect(resultado.metricas.numeroFolhas).toBe(25);
    expect(resultado.metricas.numeroCliques).toBe(1);
    expect(resultado.metricas.custoCliques as number).toBeCloseTo(2, 6);
    expect(resultado.metricas.custoSubstrato as number).toBeCloseTo(150, 6);
    expect(resultado.metricas.impressoraDigitalUsada).toMatchObject({ id: "impressora-1" });
    expect(resultado.precoUnitario.toNumber()).toBeCloseTo(0.47, 6);
    expect(resultado.precoFinal.toNumber()).toBeCloseTo(235, 6);
  });
});

describe("golden #7 — camiseta serigrafia Q=200/2 telas: setup fixo + variável, sem nesting", () => {
  it("preço final bate com o cálculo manual (calcularSetupPorPeca -> composição padrão)", () => {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "camiseta-serigrafia",
      modeloCalculo: "SERIGRAFIA",
      viraFolha: false,
      parametros: PARAMS,
      // custoSubstratoPorPeca=0 — este golden cobre só setup+variável, o
      // achado A2 (substrato) tem golden dedicado logo abaixo.
      setupPorPeca: { custoSubstratoPorPeca: 0 },
      parametrosMaquinaSetupPorPeca: { custoPorSetup: 80, custoPorPeca: 3.5, custoMinimo: 150 },
      maquinaSetupPorPecaUsada: { id: "carrossel-1", nome: "Carrossel 6 cores" },
    };

    const pedido: PedidoPrecificacao = {
      tipo: "SERIGRAFIA",
      pedido: { quantidade: 200, numeroSetups: 2 }, // 2 telas (2 cores)
      acabamentos: [],
    };

    const resultado = precificar(pedido, contexto);

    // custoSetup = 2 × 80 = 160; custoVariavel = 200 × 3,5 = 700; soma = 860,
    // acima do custoMinimo de 150 (não domina) -> custoBase = 860 ->
    // custoTotal = 860 × 1,15 = 989 -> precoBruto = 989 / 0,74 = 1336,486... ->
    // arredonda pra cima no incremento de 0,10 -> 1336,50 -> precoUnitario =
    // 1336,50/200 = 6,6825 -> 6,68 (2 casas) -> precoFinal = 6,68 × 200 = 1336,00.
    expect(resultado.metricas.custoSetup as number).toBeCloseTo(160, 6);
    expect(resultado.metricas.custoVariavel as number).toBeCloseTo(700, 6);
    expect(resultado.metricas.maquinaSetupPorPecaUsada).toMatchObject({ id: "carrossel-1" });
    expect(resultado.precoUnitario.toNumber()).toBeCloseTo(6.68, 6);
    expect(resultado.precoFinal.toNumber()).toBeCloseTo(1336, 6);
  });

  it("custoMinimo age como piso mesmo dentro do dispatcher completo", () => {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "camiseta-serigrafia-pequena",
      modeloCalculo: "SERIGRAFIA",
      viraFolha: false,
      parametros: PARAMS,
      setupPorPeca: { custoSubstratoPorPeca: 0 },
      parametrosMaquinaSetupPorPeca: { custoPorSetup: 5, custoPorPeca: 0.1, custoMinimo: 150 },
    };

    const pedido: PedidoPrecificacao = {
      tipo: "SERIGRAFIA",
      pedido: { quantidade: 5, numeroSetups: 1 },
      acabamentos: [],
    };

    const resultado = precificar(pedido, contexto);

    // custoSetup=5, custoVariavel=0,5, soma=5,5 — bem abaixo do piso de 150,
    // então custoBase = 150 (o piso domina).
    expect(resultado.detalhes.material.toNumber()).toBe(150);
  });

  it("achado A2: custoSubstratoPorPeca (ItemGrafica.precoCompra) entra no custoBase — camiseta em branco não é mais R$0", () => {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "camiseta-serigrafia-com-substrato",
      modeloCalculo: "SERIGRAFIA",
      viraFolha: false,
      parametros: PARAMS,
      // camiseta branca a R$15/un — mesma fonte que Digital já usa
      // (ItemGrafica.precoCompra), antes do fix isso nunca era lido aqui.
      setupPorPeca: { custoSubstratoPorPeca: 15 },
      parametrosMaquinaSetupPorPeca: { custoPorSetup: 80, custoPorPeca: 3.5, custoMinimo: 150 },
      maquinaSetupPorPecaUsada: { id: "carrossel-1", nome: "Carrossel 6 cores" },
    };

    const pedido: PedidoPrecificacao = {
      tipo: "SERIGRAFIA",
      pedido: { quantidade: 10, numeroSetups: 1 },
      acabamentos: [],
    };

    const resultado = precificar(pedido, contexto);

    // custoSetup = 1×80 = 80; custoVariavel = 10×3,5 = 35; custoSubstrato =
    // 10×15 = 150 (era R$0 antes do fix) -> soma = 265, acima do
    // custoMinimo de 150 -> custoBase = 265.
    expect(resultado.metricas.custoSubstrato as number).toBeCloseTo(150, 6);
    expect(resultado.detalhes.material.toNumber()).toBeCloseTo(265, 6);
  });
});

// Achado N10 da auditoria de abrangência — OFFSET era o único dos 8 branches
// de precificar() que não repassava contexto.custoFaca pra comporPreco: o
// valor era lido do formulário, validado (calcularItemOrcamento), gravado em
// ContextoPrecificacao.custoFaca, mas descartado sem erro aqui — o preço
// final de um item OFFSET nunca refletia a faca de corte-e-vinco informada.
describe("golden #8 — caixa offset com faca de corte-e-vinco (achado N10)", () => {
  // quantidade=1 de propósito: isola o teste de qualquer ruído de
  // arredondamento por unidade (precoUnitario = precoFinal / 1, sem divisão
  // fracionária) — só sobra o arredondamento pro incremento comercial.
  function precificarCaixaOffset(custoFaca?: number) {
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "caixa-offset",
      modeloCalculo: "OFFSET",
      viraFolha: false,
      parametros: PARAMS,
      parametrosPrensa: PARAMS_PRENSA,
      offset: {
        folhas: [{ id: "folha-66x96", nome: "Fechada 66x96", larguraFolha: 0.66, alturaFolha: 0.96 }],
        gramaturaGm2: 300,
        precoPorKg: 8.5,
        viraFolha: false,
      },
      custoFaca,
    };

    const pedido: PedidoPrecificacao = {
      tipo: "OFFSET",
      pedido: { larguraM: 0.09, alturaM: 0.05, quantidade: 1, corFrente: 4, corVerso: 4 },
      acabamentos: [],
    };

    return precificar(pedido, contexto);
  }

  it("custoFaca informado entra no preço final (antes deste fix era aceito, validado e descartado sem erro)", () => {
    const semFaca = precificarCaixaOffset(undefined);
    const comFaca = precificarCaixaOffset(900);

    expect(semFaca.detalhes.faca.toNumber()).toBe(0);
    expect(comFaca.detalhes.faca.toNumber()).toBe(900);

    // custoFaca soma no custoDireto ANTES de overhead/margem/encargos (ver
    // comporPreco), então a diferença no preço final é MAIOR que os R$900
    // brutos: 900 × (1 + overheadPercent) / (1 − somaEncargos) =
    // 900 × 1,15 / 0,74 = 1398,648... arredondado pra cima no incremento de
    // 0,10 do tenant — janela generosa pra absorver o arredondamento
    // independente dos dois cálculos (com/sem faca).
    const diferenca = comFaca.precoFinal.minus(semFaca.precoFinal).toNumber();
    expect(diferenca).toBeGreaterThan(1398.5);
    expect(diferenca).toBeLessThan(1398.75);
    expect(comFaca.precoFinal.toNumber()).toBeGreaterThan(semFaca.precoFinal.toNumber());
  });
});
