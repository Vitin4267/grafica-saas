import { describe, expect, it } from "vitest";
import { calcularM2 } from "../m2";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type { ContextoM2, ParametrosTenant, PedidoM2 } from "../tipos";

// Achado A5 da Parte 1 da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md): DTF (Direct to Film — transfer têxtil) existia só como
// SERVICO no catálogo mestre, sem ModeloCalculo próprio — a gráfica caía em
// SUBLIMACAO (setup-por-peça), que erra por construção: DTF não tem tela/
// matriz por arte e o custo real é POR METRO LINEAR de filme, com múltiplas
// artes "gangadas" no mesmo metro — a forma de custo é a do M2 (nesting em
// bobina), não a de setup-por-peça. DTF aponta pro MESMO calcularM2 do M2,
// com dois extras: custoSubstratoPorPeca (a camiseta) e
// custoPrensagemPorPeca (a prensa térmica).

const BOBINA = { id: "bobina-0.60", larguraNominal: 0.6, refile: 0.01 };
const DEFAULTS = { margemSegurancaPadrao: 0.02, gapPecasPadrao: 0.008 };

function contextoM2(overrides: Partial<ContextoM2> = {}): ContextoM2 {
  return {
    bobinas: [BOBINA],
    custoM2Material: 20, // filme DTF por m²
    custoImpressaoM2: 8, // tinta por m²
    areaMinimaFaturavel: 0,
    ...overrides,
  };
}

function pedido(larguraM: number, alturaM: number, quantidade: number): PedidoM2 {
  return { larguraM, alturaM, quantidade };
}

describe("achado A5 — DTF (calcularM2 com custoSubstratoPorPeca/custoPrensagemPorPeca)", () => {
  it("sem os dois campos configurados, custoBase é idêntico ao M2 puro (nenhuma regressão)", () => {
    const semDtf = calcularM2(pedido(0.3, 0.3, 10), contextoM2(), DEFAULTS);
    const comCamposZerados = calcularM2(
      pedido(0.3, 0.3, 10),
      contextoM2({ custoSubstratoPorPeca: 0, custoPrensagemPorPeca: 0 }),
      DEFAULTS
    );
    const comCamposAusentes = calcularM2(
      pedido(0.3, 0.3, 10),
      contextoM2({ custoSubstratoPorPeca: undefined, custoPrensagemPorPeca: undefined }),
      DEFAULTS
    );

    expect(semDtf.custoBase.toNumber()).toBeCloseTo(comCamposZerados.custoBase.toNumber(), 6);
    expect(semDtf.custoBase.toNumber()).toBeCloseTo(comCamposAusentes.custoBase.toNumber(), 6);
    expect(semDtf.custoSubstrato.toNumber()).toBe(0);
    expect(semDtf.custoPrensagem.toNumber()).toBe(0);
  });

  it("custoSubstrato e custoPrensagem escalam com a quantidade (Q × valor por peça)", () => {
    const resultado = calcularM2(
      pedido(0.3, 0.3, 20),
      contextoM2({ custoSubstratoPorPeca: 12, custoPrensagemPorPeca: 3.5 }),
      DEFAULTS
    );

    expect(resultado.custoSubstrato.toNumber()).toBeCloseTo(20 * 12, 6);
    expect(resultado.custoPrensagem.toNumber()).toBeCloseTo(20 * 3.5, 6);
  });

  it("custoBase = custoMaterial(filme) + custoImpressao(tinta) + custoSubstrato + custoPrensagem", () => {
    const Q = 5;
    const resultado = calcularM2(
      pedido(0.3, 0.3, Q),
      contextoM2({ custoSubstratoPorPeca: 12, custoPrensagemPorPeca: 3.5 }),
      DEFAULTS
    );

    const esperado = resultado.custoMaterial
      .plus(resultado.custoImpressao)
      .plus(resultado.custoSubstrato)
      .plus(resultado.custoPrensagem);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(esperado.toNumber(), 6);
    expect(resultado.custoSubstrato.toNumber()).toBeCloseTo(Q * 12, 6);
    expect(resultado.custoPrensagem.toNumber()).toBeCloseTo(Q * 3.5, 6);
  });

  it("PECA_EXCEDE_BOBINA continua sendo lançado normalmente pro DTF (mesmo motor, mesma validação de nesting)", () => {
    try {
      calcularM2(
        pedido(2.0, 2.0, 1), // maior que a única bobina de 0,6m
        contextoM2({ custoSubstratoPorPeca: 10, custoPrensagemPorPeca: 2 }),
        DEFAULTS
      );
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PECA_EXCEDE_BOBINA");
    }
  });
});

describe("precificar() — pedido.tipo=\"DTF\" roteia pro mesmo branch/motor de M2", () => {
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

  function contextoDTF(extra?: Partial<ContextoPrecificacao>): ContextoPrecificacao {
    return {
      itemGraficaId: "camiseta-dtf",
      modeloCalculo: "DTF",
      viraFolha: false,
      parametros: PARAMS,
      m2: contextoM2({ custoSubstratoPorPeca: 15, custoPrensagemPorPeca: 4 }),
      ...extra,
    };
  }

  it("preço final reflete overhead + margem + imposto sobre custoMaterial+custoImpressao+custoSubstrato+custoPrensagem", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "DTF",
      pedido: { larguraM: 0.3, alturaM: 0.3, quantidade: 10 },
      acabamentos: [],
    };

    const resultado = precificar(pedido, contextoDTF());

    expect(resultado.precoFinal.toNumber()).toBeGreaterThan(resultado.custoDireto.toNumber());
    expect(resultado.metricas.custoSubstrato).toBeCloseTo(10 * 15, 6);
    expect(resultado.metricas.custoPrensagem).toBeCloseTo(10 * 4, 6);
    expect(typeof resultado.metricas.custoMaterial).toBe("number");
    expect(typeof resultado.metricas.custoImpressao).toBe("number");
  });

  it("MATERIAL_SEM_BOBINA quando o contexto não tem contexto.m2 (mesmo erro de M2)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "DTF",
      pedido: { larguraM: 0.3, alturaM: 0.3, quantidade: 10 },
      acabamentos: [],
    };
    const contexto = contextoDTF();
    delete contexto.m2;

    try {
      precificar(pedido, contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("MATERIAL_SEM_BOBINA");
    }
  });
});
