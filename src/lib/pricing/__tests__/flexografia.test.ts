import { describe, expect, it } from "vitest";
import { calcularFlexografia } from "../flexografia";
import { ErroPrecificacao } from "../erros";
import type { ContextoFlexografia, ParametrosMaquinaFlexo, PedidoFlexografia } from "../tipos";

// Mesmo espírito das fixtures de golden.test.ts — números plausíveis, o que
// importa é o COMPORTAMENTO relativo (nUp por bobina, corte pela largura da
// máquina, diluição de setup por entrada), não bater centavo com uma tabela real.

function pedidoFlexoValido(overrides: Partial<PedidoFlexografia> = {}): PedidoFlexografia {
  return {
    larguraM: 0.08,
    alturaM: 0.05,
    quantidade: 100,
    numeroCores: 3,
    ...overrides,
  };
}

function paramsFlexoValidos(overrides: Partial<ParametrosMaquinaFlexo> = {}): ParametrosMaquinaFlexo {
  return {
    custoHoraMaq: 150,
    numeroEstacoesCores: 6,
    larguraMaquinaM: 0.5,
    passoCilindroM: 0.4,
    tempoAcertoH: 0.5,
    metrosAcerto: 20,
    custoMetroLinearRod: 0.8,
    rodagemMinima: 25,
    perdaPercentPadrao: 0.03,
    ...overrides,
  };
}

function contextoFlexoValido(overrides: Partial<ContextoFlexografia> = {}): ContextoFlexografia {
  return {
    bobinas: [{ id: "bobina-0.30", larguraNominal: 0.3, refile: 0.01 }],
    custoM2Material: 5,
    ...overrides,
  };
}

describe("calcularFlexografia — nUp varia conforme a largura útil da bobina escolhida", () => {
  it("bobina mais estreita cabe menos peças por volta do que uma mais larga", () => {
    // larguraEfetivaM = 0,08 + 2×0,02 = 0,12; gap padrão = 0,008
    const contextoEstreita = contextoFlexoValido({
      bobinas: [{ id: "b-030", larguraNominal: 0.3, refile: 0.01 }], // wUtil = 0,28
    });
    const contextoLarga = contextoFlexoValido({
      bobinas: [{ id: "b-060", larguraNominal: 0.6, refile: 0.01 }], // wUtil = 0,58, capado em 0,5 (largura da máquina)
    });

    const resultadoEstreita = calcularFlexografia(
      pedidoFlexoValido(),
      contextoEstreita,
      paramsFlexoValidos()
    );
    const resultadoLarga = calcularFlexografia(
      pedidoFlexoValido(),
      contextoLarga,
      paramsFlexoValidos()
    );

    expect(resultadoEstreita.nUp).toBe(2); // floor(0,288/0,128)
    expect(resultadoLarga.nUp).toBe(3); // floor(0,508/0,128)
  });

  it("entre bobinas que cabem, escolhe a de menor custoMaterial resultante", () => {
    const contexto = contextoFlexoValido({
      bobinas: [
        { id: "b-030", larguraNominal: 0.3, refile: 0.01 },
        { id: "b-060", larguraNominal: 0.6, refile: 0.01 },
      ],
    });

    const resultado = calcularFlexografia(pedidoFlexoValido(), contexto, paramsFlexoValidos());

    // b-060 cabe mais peças por volta (nUp=3 vs 2), mas cobra a largura NOMINAL
    // cheia (0,60m) por metro consumido — no fim sai mais caro que a b-030
    // (0,30m) mesmo fazendo menos voltas.
    expect(resultado.bobinaEscolhida.id).toBe("b-030");
  });
});

describe("calcularFlexografia — larguraMaquinaM capa uma bobina mais larga que a máquina", () => {
  it("nUp usa o teto da máquina, não a largura útil total da bobina", () => {
    const bobinaMuitoLarga = { id: "b-100", larguraNominal: 1.0, refile: 0 };
    const contexto = contextoFlexoValido({ bobinas: [bobinaMuitoLarga] });
    const params = paramsFlexoValidos({ larguraMaquinaM: 0.5 });

    const resultado = calcularFlexografia(pedidoFlexoValido(), contexto, params);

    // Sem o teto da máquina, wUtil=1,0 daria nUp=floor(1,008/0,128)=7; com o
    // teto de 0,5m, dá floor(0,508/0,128)=3 — prova que o cap está sendo aplicado.
    expect(resultado.nUp).toBe(3);
  });
});

describe("calcularFlexografia — entradas multiplica setup/rodagem quando numeroCores > numeroEstacoesCores", () => {
  it("dobra custoSetup e aumenta custoRodagem quando as cores exigem 2 entradas em vez de 1", () => {
    // Bobina generosa e sem cap, pra isolar o efeito de `entradas` sem
    // interferência de qual bobina é escolhida.
    const contexto = contextoFlexoValido({
      bobinas: [{ id: "b-folgada", larguraNominal: 1.0, refile: 0 }],
    });
    const params = paramsFlexoValidos({ larguraMaquinaM: 1.2 });

    const r1entrada = calcularFlexografia(
      pedidoFlexoValido({ numeroCores: 3 }), // ceil(3/6) = 1 entrada
      contexto,
      params
    );
    const r2entradas = calcularFlexografia(
      pedidoFlexoValido({ numeroCores: 8 }), // ceil(8/6) = 2 entradas
      contexto,
      params
    );

    expect(r1entrada.entradas).toBe(1);
    expect(r2entradas.entradas).toBe(2);

    // custoSetup = entradas × tempoAcertoH × custoHoraMaq — não depende de
    // metragem, então dobra de forma exata.
    expect(r1entrada.custoSetup.toNumber()).toBeCloseTo(75, 6);
    expect(r2entradas.custoSetup.toNumber()).toBeCloseTo(150, 6);

    // custoRodagem também escala com entradas, mas via max(rodagemMinima, ...)
    // por entrada — em 1 entrada a rodagem mínima ainda domina (25), em 2
    // entradas o metrosAcerto dobrado já supera o piso.
    expect(r1entrada.custoRodagem.toNumber()).toBeCloseTo(25, 3);
    expect(r2entradas.custoRodagem.toNumber()).toBeCloseTo(73.888, 3);
  });
});

describe("calcularFlexografia — rejeições (ErroPrecificacao)", () => {
  it("PECA_EXCEDE_BOBINA quando a peça não cabe na largura útil de nenhuma bobina", () => {
    const contexto = contextoFlexoValido({
      bobinas: [{ id: "b1", larguraNominal: 0.3, refile: 0.01 }],
    });
    const pedido = pedidoFlexoValido({ larguraM: 2.0 });
    const params = paramsFlexoValidos();

    expect(() => calcularFlexografia(pedido, contexto, params)).toThrow(ErroPrecificacao);
    try {
      calcularFlexografia(pedido, contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PECA_EXCEDE_BOBINA");
    }
  });

  it("PECA_EXCEDE_BOBINA quando a altura da peça excede o passo do cilindro", () => {
    const contexto = contextoFlexoValido();
    const pedido = pedidoFlexoValido({ alturaM: 0.5 }); // > passoCilindroM (0,4)
    const params = paramsFlexoValidos();

    expect(() => calcularFlexografia(pedido, contexto, params)).toThrow(ErroPrecificacao);
    try {
      calcularFlexografia(pedido, contexto, params);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PECA_EXCEDE_BOBINA");
    }
  });
});
