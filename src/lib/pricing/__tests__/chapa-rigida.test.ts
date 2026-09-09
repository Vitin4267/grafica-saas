import { describe, expect, it } from "vitest";
import { calcularChapaRigida } from "../chapa-rigida";
import { precificar, type ContextoPrecificacao, type PedidoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type {
  ContextoChapaRigida,
  ParametrosMaquinaTempo,
  ParametrosTenant,
  PedidoChapaRigida,
} from "../tipos";

// Achado A7 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// "Não existe nesting em CHAPA RÍGIDA", 2026-09-09): PVC, ACM, acrílico, MDF,
// papelão Paraná são vendidos em chapa fechada e não tinham como calcular
// quantas peças saem de uma chapa. Reaproveita a MESMA imposição 2D do
// Offset/Digital (calcularImposicao) sobre FormatoFolha, mas custoBase =
// nChapas × preço da chapa (fixo, não peso/gramatura) + Q × área da peça ×
// custoImpressaoM2 + corte OPCIONAL via MaquinaTempo.

function pedidoChapaValido(overrides: Partial<PedidoChapaRigida> = {}): PedidoChapaRigida {
  return {
    larguraM: 0.1,
    alturaM: 0.1,
    quantidade: 20,
    sangria: 0,
    margemLateral: 0,
    gapPecas: 0,
    ...overrides,
  };
}

function contextoChapaValido(overrides: Partial<ContextoChapaRigida> = {}): ContextoChapaRigida {
  return {
    folhas: [{ id: "f1", nome: "Chapa 30x30", larguraFolha: 0.3, alturaFolha: 0.3 }],
    precoPorChapa: 50,
    custoImpressaoM2: 10,
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

describe("calcularChapaRigida — imposição (nUp/nChapas), reaproveitando calcularImposicao do Offset/Digital", () => {
  it("calcula nUp a partir da geometria e deriva nChapas = ceil(Q / nUp)", () => {
    // Chapa 0.30 × 0.30m, sem margens/gaps, peça 0.10 × 0.10m — 3×3 = 9 up.
    const resultado = calcularChapaRigida(
      pedidoChapaValido({ quantidade: 20 }),
      contextoChapaValido()
    );

    expect(resultado.nUp).toBe(9);
    // 20 peças / 9 por chapa = ceil(2.22) = 3 chapas
    expect(resultado.nChapas).toBe(3);
    expect(resultado.folhaEscolhida).toEqual({ id: "f1", nome: "Chapa 30x30" });
  });

  it("escolhe o formato de chapa com MAIOR nUp entre os cadastrados (minimiza nº de chapas, preço é fixo por chapa)", () => {
    const resultado = calcularChapaRigida(
      pedidoChapaValido(),
      contextoChapaValido({
        folhas: [
          { id: "pequena", nome: "Chapa 20x20", larguraFolha: 0.2, alturaFolha: 0.2 }, // 2x2=4 up
          { id: "grande", nome: "Chapa 1220x2440mm", larguraFolha: 1.22, alturaFolha: 2.44 }, // muito maior
        ],
      })
    );

    expect(resultado.folhaEscolhida.id).toBe("grande");
    expect(resultado.nUp).toBeGreaterThan(4);
  });

  it("PECA_EXCEDE_FOLHA quando a peça não cabe em nenhuma chapa cadastrada", () => {
    try {
      calcularChapaRigida(
        pedidoChapaValido({ larguraM: 2, alturaM: 2 }),
        contextoChapaValido({
          folhas: [{ id: "pequena", nome: "Chapa 30x30", larguraFolha: 0.3, alturaFolha: 0.3 }],
        })
      );
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PECA_EXCEDE_FOLHA");
    }
  });

  it("MATERIAL_SEM_FOLHA quando a chapa não tem nenhum formato cadastrado", () => {
    try {
      calcularChapaRigida(pedidoChapaValido(), contextoChapaValido({ folhas: [] }));
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("MATERIAL_SEM_FOLHA");
    }
  });
});

describe("calcularChapaRigida — custo = nChapas × preço da chapa + Q × área da peça × custoImpressaoM2", () => {
  it("custoChapas + custoImpressao, sem corte configurado", () => {
    const resultado = calcularChapaRigida(
      pedidoChapaValido({ larguraM: 0.1, alturaM: 0.1, quantidade: 20 }),
      contextoChapaValido({
        folhas: [{ id: "f1", nome: "Chapa 30x30", larguraFolha: 0.3, alturaFolha: 0.3 }],
        precoPorChapa: 50,
        custoImpressaoM2: 10,
      })
    );

    // nUp=9, nChapas=ceil(20/9)=3 -> custoChapas = 3 × 50 = 150
    expect(resultado.nChapas).toBe(3);
    expect(resultado.custoChapas.toNumber()).toBeCloseTo(150, 6);
    // área da peça (sangria=0) = 0.1 × 0.1 = 0.01 m² ; custoImpressao = 20 × 0.01 × 10 = 2
    expect(resultado.custoImpressao.toNumber()).toBeCloseTo(2, 6);
    expect(resultado.custoCorte.toNumber()).toBe(0);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(152, 6);
  });

  it("sangria aumenta a área impressa (mesma base w'×h' que o resto do motor usa)", () => {
    const semSangria = calcularChapaRigida(
      pedidoChapaValido({ larguraM: 0.1, alturaM: 0.1, quantidade: 1, sangria: 0 }),
      contextoChapaValido({ custoImpressaoM2: 100 })
    );
    const comSangria = calcularChapaRigida(
      pedidoChapaValido({ larguraM: 0.1, alturaM: 0.1, quantidade: 1, sangria: 0.01 }),
      contextoChapaValido({ custoImpressaoM2: 100 })
    );

    expect(comSangria.custoImpressao.toNumber()).toBeGreaterThan(semSangria.custoImpressao.toNumber());
  });

  it("CUSTO_INVALIDO quando o preço da chapa é <= 0", () => {
    try {
      calcularChapaRigida(pedidoChapaValido(), contextoChapaValido({ precoPorChapa: 0 }));
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("CUSTO_INVALIDO");
    }
  });
});

describe("calcularChapaRigida — corte OPCIONAL via MaquinaTempo (achado A6, reaproveitado)", () => {
  it("soma custoCorte quando a máquina está configurada E o pedido informa tempoEstimadoMin/metrosCorte", () => {
    const resultado = calcularChapaRigida(
      pedidoChapaValido({ quantidade: 20, tempoEstimadoMin: 30 }),
      contextoChapaValido(),
      parametrosTempoValidos({ custoHoraMaq: 60, custoSetupPorJob: 15, custoMinimo: 0 })
    );

    // custoTempo = 30/60 × 60 = 30, custoSetup = 15 -> custoCorte = 45
    expect(resultado.custoCorte.toNumber()).toBeCloseTo(45, 6);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(
      resultado.custoChapas.plus(resultado.custoImpressao).plus(45).toNumber(),
      6
    );
  });

  it("NÃO cobra corte quando a máquina está configurada mas o pedido não informou tempo/metros (produto sem recorte neste job)", () => {
    const resultado = calcularChapaRigida(
      pedidoChapaValido(), // sem tempoEstimadoMin/metrosCorte
      contextoChapaValido(),
      parametrosTempoValidos()
    );

    expect(resultado.custoCorte.toNumber()).toBe(0);
  });

  it("NÃO cobra corte quando o produto não tem maquinaTempoId configurado, mesmo se o pedido informar tempo/metros", () => {
    const resultado = calcularChapaRigida(
      pedidoChapaValido({ tempoEstimadoMin: 30, metrosCorte: 5 }),
      contextoChapaValido()
      // parametrosMaquinaTempo ausente — produto sem corte configurado em Catálogo
    );

    expect(resultado.custoCorte.toNumber()).toBe(0);
  });

  it("metrosCorte sozinho (sem tempoEstimadoMin) também dispara o corte, quando a máquina cobra por metro", () => {
    const resultado = calcularChapaRigida(
      pedidoChapaValido({ metrosCorte: 10 }),
      contextoChapaValido(),
      parametrosTempoValidos({ custoHoraMaq: 60, custoSetupPorJob: 0, custoPorMetroCorte: 2 })
    );

    // custoCorte = 10 × 2 (metro) + 0 (setup) = 20
    expect(resultado.custoCorte.toNumber()).toBeCloseTo(20, 6);
  });
});

describe("calcularChapaRigida — rejeições básicas (ErroPrecificacao)", () => {
  it("QUANTIDADE_INVALIDA quando a quantidade é zero ou não inteira", () => {
    try {
      calcularChapaRigida(pedidoChapaValido({ quantidade: 0 }), contextoChapaValido());
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("QUANTIDADE_INVALIDA");
    }
  });

  it("DIMENSAO_INVALIDA quando largura ou altura estão ausentes/zeradas", () => {
    try {
      calcularChapaRigida(pedidoChapaValido({ larguraM: 0 }), contextoChapaValido());
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("DIMENSAO_INVALIDA");
    }
  });

  it("DIMENSAO_INVALIDA quando tempoEstimadoMin informado é <= 0", () => {
    try {
      calcularChapaRigida(
        pedidoChapaValido({ tempoEstimadoMin: 0 }),
        contextoChapaValido(),
        parametrosTempoValidos()
      );
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("DIMENSAO_INVALIDA");
    }
  });
});

describe("precificar() — CHAPA_RIGIDA passa pelo mesmo comporPreco de todo mundo (regressão zero pros outros modelos)", () => {
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

  function contextoChapa(extra?: Partial<ContextoPrecificacao>): ContextoPrecificacao {
    return {
      itemGraficaId: "placa-pvc-3mm",
      modeloCalculo: "CHAPA_RIGIDA",
      viraFolha: false,
      parametros: PARAMS,
      chapaRigida: {
        folhas: [{ id: "f1", nome: "Chapa 1220x2440mm", larguraFolha: 1.22, alturaFolha: 2.44 }],
        precoPorChapa: 120,
        custoImpressaoM2: 15,
      },
      ...extra,
    };
  }

  it("preço final reflete overhead + margem + imposto sobre o custo base (chapas + impressão), sem corte configurado", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "CHAPA_RIGIDA",
      pedido: { larguraM: 0.3, alturaM: 0.3, quantidade: 10 },
      acabamentos: [],
    };

    const resultado = precificar(pedido, contextoChapa());

    expect(resultado.precoFinal.toNumber()).toBeGreaterThan(resultado.custoDireto.toNumber());
    expect(resultado.metricas.custoCorte).toBe(0);
    expect(typeof resultado.metricas.nChapas).toBe("number");
    expect(resultado.metricas.folhaEscolhida).toEqual({ id: "f1", nome: "Chapa 1220x2440mm" });
  });

  it("soma custoCorte nas métricas quando o produto tem máquina de corte configurada e o pedido informa tempo/metros", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "CHAPA_RIGIDA",
      pedido: { larguraM: 0.3, alturaM: 0.3, quantidade: 10, tempoEstimadoMin: 20 },
      acabamentos: [],
    };
    const contexto = contextoChapa({
      parametrosMaquinaTempo: { custoHoraMaq: 60, custoSetupPorJob: 10, custoMinimo: 0, custoPorMetroCorte: 0 },
      maquinaTempoUsada: { id: "maq-1", nome: "Router CNC" },
    });

    const resultado = precificar(pedido, contexto);

    // custoTempo = 20/60×60 = 20; custoSetup = 10 -> custoCorte = 30
    expect(resultado.metricas.custoCorte).toBeCloseTo(30, 6);
    expect(resultado.metricas.maquinaTempoUsada).toEqual({ id: "maq-1", nome: "Router CNC" });
  });

  it("CHAPA_NAO_CONFIGURADA quando o contexto não tem chapaRigida", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "CHAPA_RIGIDA",
      pedido: { larguraM: 0.3, alturaM: 0.3, quantidade: 10 },
      acabamentos: [],
    };
    const contexto = contextoChapa();
    delete contexto.chapaRigida;

    try {
      precificar(pedido, contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("CHAPA_NAO_CONFIGURADA");
    }
  });
});
