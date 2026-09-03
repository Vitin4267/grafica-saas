import { describe, expect, it } from "vitest";
import { calcularTempoMaquina } from "../tempo-maquina";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type { ParametrosMaquinaTempo, ParametrosTenant, PedidoTempoMaquina } from "../tipos";

// Achado A6 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// Parte 1): corte/gravação a laser, router CNC, plotter de recorte — nenhum
// modelo cobra por TEMPO DE MÁQUINA. Fórmula: custoBase = tempo
// (tempoEstimadoMin/60 × custoHoraMaq) + corte (metrosCorte ×
// custoPorMetroCorte, se preenchido) + custoSetupPorJob (1× por item, não
// escala com Q) + custoMinimo como piso.

function pedidoTempoValido(overrides: Partial<PedidoTempoMaquina> = {}): PedidoTempoMaquina {
  return {
    quantidade: 10,
    tempoEstimadoMin: 30,
    ...overrides,
  };
}

function parametrosTempoValidos(overrides: Partial<ParametrosMaquinaTempo> = {}): ParametrosMaquinaTempo {
  return {
    custoHoraMaq: 60,
    custoSetupPorJob: 15,
    custoMinimo: 0,
    custoPorMetroCorte: 0,
    ...overrides,
  };
}

describe("calcularTempoMaquina — fórmula básica", () => {
  it("custoBase = tempo/60×custoHoraMaq + custoSetupPorJob, sem corte informado", () => {
    const resultado = calcularTempoMaquina(
      pedidoTempoValido({ tempoEstimadoMin: 30 }),
      parametrosTempoValidos({ custoHoraMaq: 60, custoSetupPorJob: 15 })
    );

    // custoTempo = 30/60 × 60 = 30; custoCorte = 0; custoSetup = 15
    // custoBase = 30 + 0 + 15 = 45
    expect(resultado.custoTempo.toNumber()).toBeCloseTo(30, 6);
    expect(resultado.custoCorte.toNumber()).toBeCloseTo(0, 6);
    expect(resultado.custoSetup.toNumber()).toBeCloseTo(15, 6);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(45, 6);
  });

  it("soma o custo de corte quando metrosCorte é informado", () => {
    const resultado = calcularTempoMaquina(
      pedidoTempoValido({ tempoEstimadoMin: 20, metrosCorte: 8 }),
      parametrosTempoValidos({ custoHoraMaq: 60, custoSetupPorJob: 10, custoPorMetroCorte: 2.5 })
    );

    // custoTempo = 20/60 × 60 = 20; custoCorte = 8 × 2,5 = 20; custoSetup = 10
    // custoBase = 20 + 20 + 10 = 50
    expect(resultado.custoTempo.toNumber()).toBeCloseTo(20, 6);
    expect(resultado.custoCorte.toNumber()).toBeCloseTo(20, 6);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(50, 6);
  });

  it("aceita só metrosCorte, sem tempoEstimadoMin (a gráfica escolhe a base na máquina)", () => {
    const resultado = calcularTempoMaquina(
      { quantidade: 5, metrosCorte: 12 },
      parametrosTempoValidos({ custoHoraMaq: 60, custoSetupPorJob: 5, custoPorMetroCorte: 3 })
    );

    expect(resultado.custoTempo.toNumber()).toBe(0);
    expect(resultado.custoCorte.toNumber()).toBeCloseTo(36, 6);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(41, 6);
  });

  it("custoSetupPorJob é 1× por item — não escala com a quantidade", () => {
    const resultado1 = calcularTempoMaquina(
      { quantidade: 1, tempoEstimadoMin: 15 },
      parametrosTempoValidos({ custoHoraMaq: 0, custoSetupPorJob: 40 })
    );
    const resultado100 = calcularTempoMaquina(
      { quantidade: 100, tempoEstimadoMin: 15 },
      parametrosTempoValidos({ custoHoraMaq: 0, custoSetupPorJob: 40 })
    );

    expect(resultado1.custoSetup.toNumber()).toBeCloseTo(40, 6);
    expect(resultado100.custoSetup.toNumber()).toBeCloseTo(40, 6);
  });

  it("respeita o piso de custoMinimo quando a soma fica abaixo dele", () => {
    const resultado = calcularTempoMaquina(
      pedidoTempoValido({ tempoEstimadoMin: 1 }),
      parametrosTempoValidos({ custoHoraMaq: 6, custoSetupPorJob: 0, custoMinimo: 100 })
    );

    expect(resultado.custoBase.toNumber()).toBe(100);
  });
});

describe("calcularTempoMaquina — rejeições (ErroPrecificacao)", () => {
  it("TEMPO_OU_METRO_CORTE_OBRIGATORIO quando nem tempo nem metro de corte são informados", () => {
    try {
      calcularTempoMaquina({ quantidade: 10 }, parametrosTempoValidos());
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("TEMPO_OU_METRO_CORTE_OBRIGATORIO");
    }
  });

  it("DIMENSAO_INVALIDA quando tempoEstimadoMin é zero ou negativo", () => {
    try {
      calcularTempoMaquina(pedidoTempoValido({ tempoEstimadoMin: 0 }), parametrosTempoValidos());
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("DIMENSAO_INVALIDA");
    }
  });

  it("DIMENSAO_INVALIDA quando metrosCorte é zero ou negativo", () => {
    try {
      calcularTempoMaquina({ quantidade: 10, metrosCorte: -1 }, parametrosTempoValidos());
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("DIMENSAO_INVALIDA");
    }
  });

  it("QUANTIDADE_INVALIDA quando a quantidade é zero ou não inteira", () => {
    try {
      calcularTempoMaquina(pedidoTempoValido({ quantidade: 0 }), parametrosTempoValidos());
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("QUANTIDADE_INVALIDA");
    }
  });
});

describe("precificar() — TEMPO_MAQUINA passa pelo mesmo comporPreco de todo mundo", () => {
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

  function contextoTempo(extra?: Partial<ContextoPrecificacao>): ContextoPrecificacao {
    return {
      itemGraficaId: "placa-acrilico-cortada",
      modeloCalculo: "TEMPO_MAQUINA",
      viraFolha: false,
      parametros: PARAMS,
      tempoMaquina: {},
      parametrosMaquinaTempo: {
        custoHoraMaq: 60,
        custoSetupPorJob: 15,
        custoMinimo: 0,
        custoPorMetroCorte: 2,
      },
      maquinaTempoUsada: { id: "maq-2", nome: "Router CNC MultiCam" },
      ...extra,
    };
  }

  it("preço final reflete overhead + margem + imposto sobre o custo base (tempo + corte + setup)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "TEMPO_MAQUINA",
      pedido: { quantidade: 5, tempoEstimadoMin: 40, metrosCorte: 10 },
      acabamentos: [],
    };

    const resultado = precificar(pedido, contextoTempo());

    // custoTempo = 40/60×60 = 40; custoCorte = 10×2 = 20; custoSetup = 15
    // custoBase = 40+20+15 = 75
    expect(resultado.custoDireto.toNumber()).toBeCloseTo(75, 6);
    expect(resultado.precoFinal.toNumber()).toBeGreaterThan(75);
    expect(resultado.metricas.custoTempo).toBeCloseTo(40, 6);
    expect(resultado.metricas.custoCorte).toBeCloseTo(20, 6);
    expect(resultado.metricas.custoSetup).toBeCloseTo(15, 6);
    expect(resultado.metricas.maquinaTempoUsada).toEqual({ id: "maq-2", nome: "Router CNC MultiCam" });
  });

  it("MAQUINA_TEMPO_NAO_CONFIGURADA quando o contexto não tem parametrosMaquinaTempo", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "TEMPO_MAQUINA",
      pedido: { quantidade: 5, tempoEstimadoMin: 40 },
      acabamentos: [],
    };
    const contexto = contextoTempo();
    delete contexto.parametrosMaquinaTempo;

    try {
      precificar(pedido, contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("MAQUINA_TEMPO_NAO_CONFIGURADA");
    }
  });
});
