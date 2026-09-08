import { describe, expect, it } from "vitest";
import { calcularOffset } from "../offset";
import type { ContextoOffset, ParametrosPrensa, PedidoOffset } from "../tipos";

// Cobre especificamente o achado N9 (auditoria de abrangência, 2026-09-08):
// custoRodagem escalava com entradas² (o acerto entrava duplicado — uma vez
// já totalizado em folhasSetup/folhasTotais, e de novo pelo `entradas ×
// custoRodagemPorEntrada`). Ver comentário-espelho em offset.ts e o mesmo
// teste em flexografia.test.ts.

function pedidoOffsetValido(overrides: Partial<PedidoOffset> = {}): PedidoOffset {
  return {
    larguraM: 0.2,
    alturaM: 0.2,
    quantidade: 400,
    corFrente: 1,
    corVerso: 0,
    perdaPercent: 0, // zera folhasPerda pra manter a conta manual simples
    ...overrides,
  };
}

function contextoOffsetValido(overrides: Partial<ContextoOffset> = {}): ContextoOffset {
  return {
    folhas: [{ id: "folha-0.5x0.5", nome: "0,5×0,5", larguraFolha: 0.5, alturaFolha: 0.5 }],
    gramaturaGm2: 200,
    precoPorKg: 5,
    viraFolha: false,
    ...overrides,
  };
}

function paramsPrensaValidos(overrides: Partial<ParametrosPrensa> = {}): ParametrosPrensa {
  return {
    custoHoraMaq: 200,
    torres: 1,
    custoChapa: 10,
    folhasAcerto: 50,
    tempoAcertoH: 0.25,
    custoMilheiroRod: 100,
    rodagemMinima: 1,
    perdaPercentPadrao: 0,
    ...overrides,
  };
}

describe("calcularOffset — achado N9: custoRodagem escala linear com entradas, não quadrático", () => {
  it("a parcela de acerto do custoRodagem multiplica por 6× (entradas), não por 36× (entradas²)", () => {
    // Mesma peça/folha/quantidade nos dois cenários — só corFrente muda
    // (torres=1 faz entradas = corFrente exatamente), então folhasBoas/
    // folhasPerda são IDÊNTICAS nos dois casos; só `entradas` varia.
    const contexto = contextoOffsetValido();
    const params = paramsPrensaValidos();

    const r1entrada = calcularOffset(pedidoOffsetValido({ corFrente: 1 }), contexto, params);
    const r6entradas = calcularOffset(pedidoOffsetValido({ corFrente: 6 }), contexto, params);

    expect(r1entrada.entradas).toBe(1);
    expect(r6entradas.entradas).toBe(6);

    // Cálculo manual da imposição: wLinha=hLinha=0,2+2×0,003=0,206;
    // lu=0,5-0,012-2×0,01=0,468; au=0,5-2×0,01=0,48;
    // nUp = floor((0,468+0,002)/(0,206+0,002)) × floor((0,48+0,002)/(0,206+0,002))
    //     = floor(0,47/0,208) × floor(0,482/0,208) = 2 × 2 = 4
    expect(r1entrada.nUp).toBe(4);
    // folhasBoas = ceil(400/4) = 100; folhasPerda = 0 (perdaPercent=0) —
    // iguais nos dois cenários.
    expect(r1entrada.folhasBoas).toBe(100);
    expect(r1entrada.folhasPerda).toBe(0);
    expect(r6entradas.folhasBoas).toBe(100);
    expect(r6entradas.folhasPerda).toBe(0);

    // folhasParaRodagemPorEntrada = folhasBoas + folhasPerda + folhasAcerto
    //   = 100 + 0 + 50 = 150 (NÃO depende de `entradas` — ao contrário do
    //   folhasSetup/folhasTotais usados no cálculo físico de papel abaixo)
    // custoRodagemPorEntrada = max(1, 150/1000 × 100) = max(1, 15) = 15
    //   (igual nos dois cenários)
    // custoRodagem(1 entrada)  = 1 × 15 = 15
    // custoRodagem(6 entradas) = 6 × 15 = 90
    expect(r1entrada.custoRodagem.toNumber()).toBeCloseTo(15, 6);
    expect(r6entradas.custoRodagem.toNumber()).toBeCloseTo(90, 6);

    // A prova central do achado N9: razão EXATAMENTE 6 (linear em entradas).
    // Com o bug antigo (folhasTotais — já o TOTAL do job, com folhasSetup =
    // folhasAcerto × entradas — reentrando no cálculo por entrada), essa
    // razão teria dado 240/15 = 16, não 6.
    const razao = r6entradas.custoRodagem.div(r1entrada.custoRodagem).toNumber();
    expect(razao).toBeCloseTo(6, 6);

    // Consumo FÍSICO de papel (custoPapel, pesoTotalPedidoKg) NÃO muda de
    // fórmula — continua usando folhasTotais = folhasBoas + folhasPerda +
    // folhasSetup, com folhasSetup = folhasAcerto × entradas (o total real
    // de folhas gastas/pesadas, que de fato escala com entradas: cada
    // entrada consome fisicamente seu próprio lote de folhas de acerto).
    // Só o custo de RODAGEM estava errado, não a contagem de papel.
    // entradas=1: folhasSetup=50×1=50  → folhasTotais=100+0+50=150
    // entradas=6: folhasSetup=50×6=300 → folhasTotais=100+0+300=400
    expect(r1entrada.folhasTotais).toBe(150);
    expect(r6entradas.folhasTotais).toBe(400);
    // pesoFolhaKg = 0,5×0,5×200/1000 = 0,05 kg/folha
    // pesoTotalPedidoKg = folhasTotais × pesoFolhaKg
    expect(r1entrada.pesoTotalPedidoKg.toNumber()).toBeCloseTo(7.5, 6);
    expect(r6entradas.pesoTotalPedidoKg.toNumber()).toBeCloseTo(20, 6);
    // custoPapel = folhasTotais × pesoFolhaKg × precoPorKg(5)
    expect(r1entrada.custoPapel.toNumber()).toBeCloseTo(37.5, 6);
    expect(r6entradas.custoPapel.toNumber()).toBeCloseTo(100, 6);
  });
});
