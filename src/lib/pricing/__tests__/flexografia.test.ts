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

    // custoRodagem também escala com entradas, via max(rodagemMinima, ...)
    // POR ENTRADA — e cada entrada só carrega o SEU PRÓPRIO metrosAcerto
    // (20), não o metrosAcerto × entradas do job inteiro. Correção do
    // achado N9 (auditoria de abrangência, 2026-09-08): o valor antigo deste
    // teste (73,888) assumia o bug — metragemTotal usada no cálculo por
    // entrada já trazia metragemSetup = metrosAcerto × entradas (o total do
    // job), e `entradas × custoRodagemPorEntrada` multiplicava esse total
    // por entradas DE NOVO, fazendo a parcela de acerto escalar com
    // entradas² em vez de entradas.
    //
    // Recálculo manual sob a fórmula corrigida (metragemBoa=6,0,
    // metragemPerda=0,18 — ambas independentes de `entradas` neste cenário
    // — e metrosAcerto=20 por entrada, não por job):
    //   metragemParaRodagemPorEntrada = 6,0 + 0,18 + 20 = 26,18
    //   custoRodagemPorEntrada = max(25, 26,18 × 0,8) = max(25, 20,944) = 25
    //     (o piso rodagemMinima domina em AMBOS os cenários agora, já que o
    //     acerto de UMA entrada só não é grande o bastante pra superá-lo —
    //     diferente do bug antigo, que somava o acerto de todas as entradas
    //     antes de comparar com o piso)
    //   custoRodagem(1 entrada)  = 1 × 25 = 25
    //   custoRodagem(2 entradas) = 2 × 25 = 50
    // Ainda dobra (25 → 50), só que agora via `entradas` multiplicando o
    // MESMO custo-por-entrada, não via a metragem-base inflada pelo bug.
    expect(r1entrada.custoRodagem.toNumber()).toBeCloseTo(25, 3);
    expect(r2entradas.custoRodagem.toNumber()).toBeCloseTo(50, 3);
  });
});

describe("calcularFlexografia — achado N9: custoRodagem escala linear com entradas, não quadrático", () => {
  it("a parcela de acerto do custoRodagem multiplica por 6× (entradas), não por 36× (entradas²)", () => {
    // Mesma bobina/peça/quantidade nos dois cenários — só numeroCores muda
    // (numeroEstacoesCores=1 faz entradas = numeroCores exatamente), então
    // metragemBoa/metragemPerda são IDÊNTICAS nos dois casos; só `entradas`
    // varia. metrosAcerto alto (100) e rodagemMinima baixa (1) garantem que
    // o piso não mascare o efeito — a parcela de acerto domina o cálculo.
    const contexto = contextoFlexoValido({
      bobinas: [{ id: "b-folgada", larguraNominal: 1.0, refile: 0 }],
    });
    const params = paramsFlexoValidos({
      larguraMaquinaM: 1.2,
      numeroEstacoesCores: 1,
      metrosAcerto: 100,
      custoMetroLinearRod: 0.8,
      rodagemMinima: 1,
    });

    const r1entrada = calcularFlexografia(pedidoFlexoValido({ numeroCores: 1 }), contexto, params);
    const r6entradas = calcularFlexografia(pedidoFlexoValido({ numeroCores: 6 }), contexto, params);

    expect(r1entrada.entradas).toBe(1);
    expect(r6entradas.entradas).toBe(6);

    // Cálculo manual (nUp=floor(1,008/0,128)=7; numRevolucoes=ceil(100/7)=15;
    // metragemBoa=15×0,4=6,0; metragemPerda=6,0×0,03=0,18 — iguais nos dois
    // cenários):
    //   metragemParaRodagemPorEntrada = 6,0 + 0,18 + 100 = 106,18
    //   custoRodagemPorEntrada = max(1, 106,18 × 0,8) = 84,944 (igual nos
    //     dois cenários, pois não depende de `entradas`)
    //   custoRodagem(1 entrada)  = 1 × 84,944 =  84,944
    //   custoRodagem(6 entradas) = 6 × 84,944 = 509,664
    expect(r1entrada.custoRodagem.toNumber()).toBeCloseTo(84.944, 3);
    expect(r6entradas.custoRodagem.toNumber()).toBeCloseTo(509.664, 3);

    // A prova central do achado N9: a razão é EXATAMENTE 6 (linear em
    // entradas). Com o bug antigo (folhasSetup/metragemSetup — já o TOTAL
    // do job — reentrando na conta por entrada) essa razão teria vindo bem
    // maior que 6 (o acerto sendo cobrado ~entradas² vezes).
    const razao = r6entradas.custoRodagem.div(r1entrada.custoRodagem).toNumber();
    expect(razao).toBeCloseTo(6, 6);

    // Consumo FÍSICO de material (metragemLinearM/custoMaterial) NÃO muda de
    // fórmula — continua usando metragemTotal (com metragemSetup =
    // metrosAcerto × entradas, o total real gasto/pesado). Só o custo de
    // rodagem estava errado.
    // entradas=1: metragemSetup=100×1=100 → metragemTotal=6,0+0,18+100=106,18
    // entradas=6: metragemSetup=100×6=600 → metragemTotal=6,0+0,18+600=606,18
    expect(r1entrada.metragemLinearM.toNumber()).toBeCloseTo(106.18, 6);
    expect(r6entradas.metragemLinearM.toNumber()).toBeCloseTo(606.18, 6);
    // custoMaterial = metragemTotal × larguraNominal(1,0) × custoM2Material(5)
    expect(r1entrada.custoMaterial.toNumber()).toBeCloseTo(530.9, 6);
    expect(r6entradas.custoMaterial.toNumber()).toBeCloseTo(3030.9, 6);
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
