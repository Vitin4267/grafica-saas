import { describe, expect, it } from "vitest";
import { calcularDigital } from "../digital";
import { ErroPrecificacao } from "../erros";
import type { ContextoDigital, ParametrosImpressoraDigital, PedidoDigital } from "../tipos";

// Achado N4 da auditoria de código (2026-09-04) — Digital agora faz IMPOSIÇÃO
// igual ao Offset: lê os FormatoFolha do papel escolhido no orçamento,
// calcula nUp (peças por folha) e deriva numeroFolhas = ceil(Q / nUp).
// custoCliques/custoSubstrato são cobrados POR FOLHA, não mais por peça.

function pedidoDigitalValido(overrides: Partial<PedidoDigital> = {}): PedidoDigital {
  return {
    larguraM: 0.09, // cartão de visita 9x5cm
    alturaM: 0.05,
    quantidade: 100,
    ...overrides,
  };
}

function contextoDigitalValido(overrides: Partial<ContextoDigital> = {}): ContextoDigital {
  return {
    folhas: [{ id: "folha-sra3", nome: "SRA3", larguraFolha: 0.32, alturaFolha: 0.45 }],
    custoPorFolha: 0.5,
    ...overrides,
  };
}

function paramsImpressoraValidos(
  overrides: Partial<ParametrosImpressoraDigital> = {}
): ParametrosImpressoraDigital {
  return {
    custoPorClique: 0.08,
    ...overrides,
  };
}

describe("calcularDigital — imposição (nUp/numeroFolhas)", () => {
  it("calcula nUp a partir da geometria e deriva numeroFolhas = ceil(Q / nUp)", () => {
    // Folha 0.30 × 0.30m, sem margens/gaps (zerados pra fazer a conta de
    // cabeça), peça 0.10 × 0.10m — 3×3 = 9 peças por folha.
    const resultado = calcularDigital(
      pedidoDigitalValido({
        larguraM: 0.1,
        alturaM: 0.1,
        quantidade: 20,
        sangria: 0,
        margemLateral: 0,
        gapPecas: 0,
      }),
      contextoDigitalValido({
        folhas: [{ id: "f1", nome: "Folha 30x30", larguraFolha: 0.3, alturaFolha: 0.3 }],
        custoPorFolha: 1,
      }),
      paramsImpressoraValidos({ custoPorClique: 0.1 })
    );

    expect(resultado.nUp).toBe(9);
    // 20 peças / 9 por folha = ceil(2.22) = 3 folhas
    expect(resultado.numeroFolhas).toBe(3);
    expect(resultado.numeroCliques).toBe(1); // default: 1 clique por folha
    // custoCliques = 3 folhas × 1 clique × 0,1 = 0,3
    expect(resultado.custoCliques.toNumber()).toBeCloseTo(0.3, 6);
    // custoSubstrato = 3 folhas × 1 (custoPorFolha) = 3
    expect(resultado.custoSubstrato.toNumber()).toBeCloseTo(3, 6);
    expect(resultado.custoBase.toNumber()).toBeCloseTo(3.3, 6);
    expect(resultado.folhaEscolhida).toEqual({ id: "f1", nome: "Folha 30x30" });
  });

  it("escolhe o formato de folha com MAIOR nUp entre os cadastrados (minimiza nº de folhas)", () => {
    const resultado = calcularDigital(
      pedidoDigitalValido({ larguraM: 0.1, alturaM: 0.1, sangria: 0, margemLateral: 0, gapPecas: 0 }),
      contextoDigitalValido({
        folhas: [
          { id: "pequena", nome: "Folha 20x20", larguraFolha: 0.2, alturaFolha: 0.2 }, // 2x2=4 up
          { id: "grande", nome: "Folha 30x30", larguraFolha: 0.3, alturaFolha: 0.3 }, // 3x3=9 up
        ],
      }),
      paramsImpressoraValidos()
    );

    expect(resultado.folhaEscolhida.id).toBe("grande");
    expect(resultado.nUp).toBe(9);
  });

  it("numeroCliques override manual sobrepõe o default de 1 clique por folha", () => {
    const resultado = calcularDigital(
      pedidoDigitalValido({
        larguraM: 0.1,
        alturaM: 0.1,
        quantidade: 20,
        sangria: 0,
        margemLateral: 0,
        gapPecas: 0,
        numeroCliques: 2, // ex: frente e verso, 2 passadas por folha
      }),
      contextoDigitalValido({
        folhas: [{ id: "f1", nome: "Folha 30x30", larguraFolha: 0.3, alturaFolha: 0.3 }],
        custoPorFolha: 1,
      }),
      paramsImpressoraValidos({ custoPorClique: 0.1 })
    );

    expect(resultado.numeroFolhas).toBe(3);
    expect(resultado.numeroCliques).toBe(2);
    // custoCliques = 3 folhas × 2 cliques × 0,1 = 0,6 (dobro do default)
    expect(resultado.custoCliques.toNumber()).toBeCloseTo(0.6, 6);
    // custoSubstrato não muda com o override de cliques — ainda 3 folhas × 1
    expect(resultado.custoSubstrato.toNumber()).toBeCloseTo(3, 6);
  });

  it("materialFornecidoPeloCliente=true zera custoSubstrato mas continua cobrando cliques (a impressora ainda processa as folhas)", () => {
    const resultado = calcularDigital(
      pedidoDigitalValido({ larguraM: 0.1, alturaM: 0.1, sangria: 0, margemLateral: 0, gapPecas: 0 }),
      contextoDigitalValido({
        folhas: [{ id: "f1", nome: "Folha 30x30", larguraFolha: 0.3, alturaFolha: 0.3 }],
        custoPorFolha: 0,
        materialFornecidoPeloCliente: true,
      }),
      paramsImpressoraValidos({ custoPorClique: 0.1 })
    );

    expect(resultado.custoSubstrato.toNumber()).toBe(0);
    expect(resultado.custoCliques.toNumber()).toBeGreaterThan(0);
  });
});

describe("calcularDigital — golden: exemplo do achado N4 (1.000 cartões de visita, 24-up)", () => {
  it("~42 folhas/cliques, NÃO 1000 (o bug original cobrava peça-a-peça)", () => {
    // Cartão de visita padrão 9x5cm numa folha SRA3 (0.32 × 0.45m) cabe
    // 24-up com sangria/margens realistas — geometria escolhida pra bater
    // com o enunciado do achado (gráfica rápida, 1000 cartões, 24-up).
    const resultado = calcularDigital(
      pedidoDigitalValido({
        larguraM: 0.09,
        alturaM: 0.05,
        quantidade: 1000,
        sangria: 0.0015,
        margemLateral: 0.005,
        gapPecas: 0.002,
      }),
      contextoDigitalValido({
        folhas: [{ id: "sra3", nome: "SRA3", larguraFolha: 0.32, alturaFolha: 0.45 }],
        custoPorFolha: 0.8,
      }),
      paramsImpressoraValidos({ custoPorClique: 0.09 })
    );

    // 24-up é o cenário do achado — confirma que a imposição bate com a
    // realidade física de uma SRA3 pra este tamanho de cartão.
    expect(resultado.nUp).toBe(24);
    // ceil(1000 / 24) = 42 — o número que o achado chama de "≈42".
    expect(resultado.numeroFolhas).toBe(42);
    expect(resultado.numeroCliques).toBe(1);

    // O BUG original cobrava 1000 cliques e 1000 substratos — a correção
    // cobra ~42 de cada, uma diferença de ordem de grandeza (~24×).
    expect(resultado.numeroFolhas).toBeLessThan(1000 / 20); // bem longe de Q
    const custoClique = 0.09;
    const custoPorFolha = 0.8;
    expect(resultado.custoCliques.toNumber()).toBeCloseTo(42 * 1 * custoClique, 6);
    expect(resultado.custoSubstrato.toNumber()).toBeCloseTo(42 * custoPorFolha, 6);

    // Nunca bate com a conta ERRADA antiga (Q × custoPorClique / Q × custoPorFolha).
    expect(resultado.custoCliques.toNumber()).not.toBeCloseTo(1000 * custoClique, 1);
    expect(resultado.custoSubstrato.toNumber()).not.toBeCloseTo(1000 * custoPorFolha, 1);
  });
});

describe("calcularDigital — peça não cabe em nenhuma folha (PECA_EXCEDE_FOLHA)", () => {
  it("lança erro amigável, não R$0 silencioso nem exceção genérica", () => {
    try {
      calcularDigital(
        pedidoDigitalValido({ larguraM: 1, alturaM: 1 }), // peça de 1x1m
        contextoDigitalValido({
          folhas: [{ id: "pequena", nome: "SRA3", larguraFolha: 0.32, alturaFolha: 0.45 }],
        }),
        paramsImpressoraValidos()
      );
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PECA_EXCEDE_FOLHA");
      expect((erro as ErroPrecificacao).message).toMatch(/não cabe/i);
    }
  });
});

describe("calcularDigital — rejeições (ErroPrecificacao)", () => {
  it("QUANTIDADE_INVALIDA quando a quantidade é zero ou não inteira", () => {
    const contexto = contextoDigitalValido();
    const params = paramsImpressoraValidos();

    expect(() => calcularDigital(pedidoDigitalValido({ quantidade: 0 }), contexto, params)).toThrow(
      ErroPrecificacao
    );
    try {
      calcularDigital(pedidoDigitalValido({ quantidade: 0 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("QUANTIDADE_INVALIDA");
    }
  });

  it("DIMENSAO_INVALIDA quando largura ou altura estão ausentes/zeradas (achado N4 — agora obrigatórias)", () => {
    const contexto = contextoDigitalValido();
    const params = paramsImpressoraValidos();

    try {
      calcularDigital(pedidoDigitalValido({ larguraM: 0 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("DIMENSAO_INVALIDA");
    }
  });

  it("MATERIAL_SEM_FOLHA quando o papel escolhido não tem nenhum formato cadastrado", () => {
    const params = paramsImpressoraValidos();

    try {
      calcularDigital(pedidoDigitalValido(), contextoDigitalValido({ folhas: [] }), params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("MATERIAL_SEM_FOLHA");
    }
  });

  it("NUMERO_CLIQUES_INVALIDO quando numeroCliques é informado mas é zero ou fracionário", () => {
    const contexto = contextoDigitalValido();
    const params = paramsImpressoraValidos();

    try {
      calcularDigital(pedidoDigitalValido({ numeroCliques: 0 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_CLIQUES_INVALIDO");
    }

    try {
      calcularDigital(pedidoDigitalValido({ numeroCliques: 1.5 }), contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_CLIQUES_INVALIDO");
    }
  });

  it("CUSTO_INVALIDO quando o papel não tem preço de compra cadastrado (<= 0) e o material não foi fornecido pelo cliente", () => {
    const params = paramsImpressoraValidos();

    try {
      calcularDigital(pedidoDigitalValido(), contextoDigitalValido({ custoPorFolha: 0 }), params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("CUSTO_INVALIDO");
    }
  });
});
