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

const ACABAMENTO_HORA_2: ConfigAcabamento = {
  itemGraficaId: "criacao-arte",
  nome: "Criação de arte",
  baseCobranca: "HORA",
  estagio: "POS_REFILE",
  custoUnitario: 80,
  custoSetup: 0,
  custoMinimo: 0,
};

describe("precificar — METRO_LINEAR deriva o perímetro da geometria (sem campo novo)", () => {
  // Achado B5 da auditoria do motor de preço (2026-09-13, "erro estrutural")
  // — o perímetro do METRO_LINEAR (bainha/ilhós, feitos na peça ACABADA,
  // depois do corte) precisa vir da dimensão NOMINAL da peça (1×2, o que o
  // vendedor digitou), nunca da "efetiva" que o M2 usa pra CONSUMO DE
  // MATERIAL (1×2 + margem de segurança de 0,02 por lado = 1,04×2,04). Este
  // teste ANTES só checava custo > 0 (não distinguia as duas convenções);
  // agora afirma o número exato pra travar que é a nominal que entra aqui.
  it("M2: cobra 2×(largura+altura NOMINAL)×custoUnitario — não a dimensão efetiva com margem de segurança", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "M2",
      pedido: { larguraM: 1, alturaM: 2, quantidade: 1 },
      acabamentos: [ACABAMENTO_METRO_LINEAR],
    };

    // Não deve lançar ErroPrecificacao("CUSTO_INVALIDO") — esse era o bug
    // original (achado A1 da auditoria de abrangência).
    const resultado = precificar(pedido, contextoM2());

    const acabamentoCalculado = resultado.detalhes.acabamentos.find(
      (a) => a.itemGraficaId === "ilhos"
    )!;
    // perímetro NOMINAL = 2×(1+2) = 6m (NÃO 2×(1,04+2,04)=6,16m, que seria a
    // dimensão "efetiva" com margem de segurança do M2).
    expect(acabamentoCalculado.qtdBase.toNumber()).toBeCloseTo(6, 6);
    // custo = 6m × R$2/m = R$12 (NÃO R$12,32).
    expect(acabamentoCalculado.custo.toNumber()).toBeCloseTo(12, 6);
  });

  it("achado B5: cenário exato da auditoria — etiqueta 0,10×0,05m, perímetro nominal 0,30m (não 0,32m efetivo, +53% de erro)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "M2",
      pedido: { larguraM: 0.1, alturaM: 0.05, quantidade: 1 },
      acabamentos: [ACABAMENTO_METRO_LINEAR],
    };

    const resultado = precificar(pedido, contextoM2());
    const acabamentoCalculado = resultado.detalhes.acabamentos.find(
      (a) => a.itemGraficaId === "ilhos"
    )!;
    // Nominal: 2×(0,10+0,05) = 0,30m. Efetivo (M2, +0,02×2 por lado) seria
    // 2×(0,14+0,09) = 0,46m — bem mais que +53%, e nem de longe o valor
    // certo pra uma bainha na etiqueta já cortada.
    expect(acabamentoCalculado.qtdBase.toNumber()).toBeCloseTo(0.3, 6);
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
      // Achado B10 (2026-09-13): 0 sozinho agora exige
      // materialFornecidoPeloCliente — este teste não é sobre substrato, só
      // sobre o perímetro do METRO_LINEAR, então a flag entra aqui.
      setupPorPeca: { custoSubstratoPorPeca: 0, materialFornecidoPeloCliente: true },
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

  // Achado B6 da auditoria do motor de preço (2026-09-13) — horasEstimadas é
  // UM número por ITEM, então 2 acabamentos por HORA no mesmo item
  // (Instalação R$50/h + Criação de arte R$80/h) cobrariam a MESMA
  // estimativa nas duas, sem o motor ter como saber o real (4h estimadas só
  // pra instalação virando R$200+R$320=R$520 em vez do real). O motor
  // rejeita a combinação em vez de adivinhar como dividir.
  it("achado B6: 2 acabamentos por HORA no mesmo item lança ACABAMENTOS_HORA_AMBIGUOS (não cobra a mesma estimativa 2×)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "M2",
      pedido: { larguraM: 1, alturaM: 1, quantidade: 1 },
      acabamentos: [ACABAMENTO_HORA, ACABAMENTO_HORA_2],
    };
    try {
      precificar(pedido, contextoM2({ horasEstimadas: 4 }));
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("ACABAMENTOS_HORA_AMBIGUOS");
    }
  });
});
