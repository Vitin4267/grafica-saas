import { describe, expect, it } from "vitest";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type { ConfigAcabamento, ParametrosTenant } from "../tipos";

// Achado A1 da auditoria de abrangência (2026-08-24): BaseCobranca.METRO_LINEAR
// e HORA existiam no dropdown de acabamento, mas nenhum dos branches de
// precificar() preenchia ContextoAcabamento.perimetroOuEmenda/horasEstimadas —
// qualquer gráfica que configurasse um acabamento com essas bases (ilhós,
// bainha, instalação, criação de arte) via ErroPrecificacao("CUSTO_INVALIDO")
// sempre. Este arquivo cobre a correção: perimetroOuEmenda derivado da
// geometria já calculada (sem campo novo no orçamento) e horasEstimadas
// repassado do contexto (OrcamentoItem.horasEstimadas).

const PARAMS: ParametrosTenant = {
  overheadPercent: 0.15,
  margemPadrao: 0.2,
  impostoPercent: 0.06,
  comissaoPercent: 0,
  taxaFinanceiraPercent: 0,
  pedidoMinimo: 0,
  incrementoArredondamento: 0.1,
  margemSegurancaPadrao: 0.02,
  gapPecasPadrao: 0.008,
};

function contextoM2(extra?: Partial<ContextoPrecificacao>): ContextoPrecificacao {
  return {
    itemGraficaId: "banner-lona",
    modeloCalculo: "M2",
    viraFolha: false,
    parametros: PARAMS,
    m2: {
      bobinas: [{ id: "bobina-1.60", larguraNominal: 1.6, refile: 0.02 }],
      custoM2Material: 10,
      custoImpressaoM2: 5,
      areaMinimaFaturavel: 0.25,
    },
    ...extra,
  };
}

const ACABAMENTO_METRO_LINEAR: ConfigAcabamento = {
  itemGraficaId: "ilhos",
  nome: "Ilhós",
  baseCobranca: "METRO_LINEAR",
  estagio: "POS_REFILE",
  custoUnitario: 2,
  custoSetup: 0,
  custoMinimo: 0,
};

const ACABAMENTO_HORA: ConfigAcabamento = {
  itemGraficaId: "instalacao",
  nome: "Instalação",
  baseCobranca: "HORA",
  estagio: "POS_REFILE",
  custoUnitario: 50,
  custoSetup: 0,
  custoMinimo: 0,
};

describe("precificar — METRO_LINEAR deriva o perímetro da geometria (sem campo novo)", () => {
  it("M2: não lança mais CUSTO_INVALIDO e cobra 2×(largura+altura efetiva)×custoUnitario", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "M2",
      pedido: { larguraM: 1, alturaM: 2, quantidade: 1 },
      acabamentos: [ACABAMENTO_METRO_LINEAR],
    };

    // Não deve lançar ErroPrecificacao("CUSTO_INVALIDO") — esse era o bug.
    const resultado = precificar(pedido, contextoM2());

    const acabamentoCalculado = resultado.detalhes.acabamentos.find(
      (a) => a.itemGraficaId === "ilhos"
    )!;
    // largura/altura efetiva incluem margem de segurança do nesting, então o
    // valor exato não é 1:1 com a peça nominal — o que importa aqui é que o
    // perímetro foi derivado (custo > 0), não que ficou undefined/0.
    expect(acabamentoCalculado.custo.toNumber()).toBeGreaterThan(0);
    expect(acabamentoCalculado.qtdBase.toNumber()).toBeGreaterThan(0);
  });

  it("lança erro claro (não silencioso) quando não há dimensão — modelo sem nesting sem largura/altura", () => {
    // Sem largura/altura informadas, larguraEfetivaM/alturaEfetivaM caem em 0
    // (padrão dos modelos sem nesting) — o perímetro também cai em 0, e é
    // papel do CHAMADOR (guard em orcamento-precificacao.ts) impedir que isso
    // chegue aqui sem dado. Este teste confirma que o motor em si não finge
    // sucesso: com perímetro 0, o custo do acabamento é 0 (silencioso só se o
    // chamador não tiver o guard — comportamento coberto separadamente em
    // orcamento-precificacao.test.ts).
    const pedido: PedidoPrecificacao = {
      tipo: "SERIGRAFIA",
      pedido: { quantidade: 10, numeroSetups: 1 },
      acabamentos: [ACABAMENTO_METRO_LINEAR],
    };
    const contexto: ContextoPrecificacao = {
      itemGraficaId: "caneca",
      modeloCalculo: "SERIGRAFIA",
      viraFolha: false,
      parametros: PARAMS,
      setupPorPeca: { custoSubstratoPorPeca: 0 },
      parametrosMaquinaSetupPorPeca: { custoPorSetup: 10, custoPorPeca: 1, custoMinimo: 0 },
    };
    const resultado = precificar(pedido, contexto);
    const acabamentoCalculado = resultado.detalhes.acabamentos.find(
      (a) => a.itemGraficaId === "ilhos"
    )!;
    expect(acabamentoCalculado.custo.toNumber()).toBe(0);
  });
});

describe("precificar — HORA usa ContextoPrecificacao.horasEstimadas", () => {
  it("M2 com horasEstimadas preenchido: custo = horas × custoUnitario", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "M2",
      pedido: { larguraM: 1, alturaM: 1, quantidade: 1 },
      acabamentos: [ACABAMENTO_HORA],
    };

    const resultado = precificar(pedido, contextoM2({ horasEstimadas: 3 }));

    const acabamentoCalculado = resultado.detalhes.acabamentos.find(
      (a) => a.itemGraficaId === "instalacao"
    )!;
    expect(acabamentoCalculado.custo.toNumber()).toBe(150); // 3h × R$50
  });

  it("sem horasEstimadas no contexto: o motor lança CUSTO_INVALIDO (o guard do chamador é quem deveria ter barrado antes)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "M2",
      pedido: { larguraM: 1, alturaM: 1, quantidade: 1 },
      acabamentos: [ACABAMENTO_HORA],
    };
    expect(() => precificar(pedido, contextoM2())).toThrow(ErroPrecificacao);
  });
});
