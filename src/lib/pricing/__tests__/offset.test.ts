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

// Achado 1 da auditoria do motor M2/Offset (2026-09-12): em work-and-turn
// (viração), o MESMO jogo de chapas imprime frente e verso da MESMA folha
// física — cada folha rende nUp/2 peças COMPLETAS, não nUp. O bug: o
// desconto de chapa (nChapas/2) já existia, mas folhasBoas continuava
// dividindo por nUp inteiro — o motor dava o desconto na chapa e ainda
// cobrava o papel como se o jogo fosse duplo (metade do papel sumia do
// orçamento). Este describe é o primeiro teste deste arquivo a cobrir
// viraFolha:true — antes só viraFolha:false era testado.
describe("calcularOffset — achado 1: work-and-turn cobra o papel real (nUp/2 peças por folha), não nUp", () => {
  it("folhasBoas usa nUp/2 (não nUp) quando viraFolha=true, F===V e nUp é par", () => {
    // Mesma imposição do describe acima (0,5×0,5 folha, peça 0,2×0,2) → nUp=4
    // (par). torres=4 faz entradas = ceil(4/4)+ceil(4/4) = 1+1 = 2.
    const contexto = contextoOffsetValido({ viraFolha: true });
    const params = paramsPrensaValidos({ torres: 4 });
    const pedido = pedidoOffsetValido({ quantidade: 400, corFrente: 4, corVerso: 4 });

    const resultado = calcularOffset(pedido, contexto, params);

    expect(resultado.nUp).toBe(4);
    expect(resultado.entradas).toBe(2);
    // nUpPecasCompletas = 4/2 = 2 (work-and-turn ativo: F===V=4, nUp par).
    // folhasBoas = ceil(400/2) = 200 — NÃO ceil(400/4)=100 (bug antigo).
    expect(resultado.folhasBoas).toBe(200);
    // nChapas = (4+4)/2 = 4 (desconto de chapa, já existia antes do fix).
    expect(resultado.nChapas).toBe(4);
    expect(resultado.custoChapas.toNumber()).toBeCloseTo(40, 6); // 4 × custoChapa(10)

    // folhasSetup = folhasAcerto(50) × entradas(2) = 100.
    // folhasTotais = folhasBoas(200) + folhasPerda(0) + folhasSetup(100) = 300.
    expect(resultado.folhasTotais).toBe(300);
    // custoPapel = folhasTotais(300) × pesoFolhaKg(0,05) × precoPorKg(5) = 75
    // — o bug antigo dava 50 (folhasTotais=200), 33% de papel faltando.
    expect(resultado.custoPapel.toNumber()).toBeCloseTo(75, 6);

    // folhasParaRodagemPorEntrada = folhasBoas(200)+folhasPerda(0)+folhasAcerto(50) = 250
    // custoRodagemPorEntrada = max(1, 250/1000×100) = 25; custoRodagem = 2×25 = 50
    // — o bug antigo dava 30 (folhasBoas=100 na conta de rodagem também).
    expect(resultado.custoRodagem.toNumber()).toBeCloseTo(50, 6);

    // custoBase = custoPapel(75) + custoChapas(40) + custoRodagem(50) +
    // custoSetup(2×0,25×200=100) = 265 — o bug antigo dava 220.
    expect(resultado.custoBase.toNumber()).toBeCloseTo(265, 6);
  });

  it("F≠V não aplica a otimização — folhasBoas usa nUp inteiro mesmo com viraFolha=true", () => {
    // Mesma imposição (nUp=4), mas corFrente≠corVerso: work-and-turn não é
    // fisicamente possível (o mesmo jogo de chapas não serve pros dois
    // lados com contagens de cor diferentes) — folhasBoas e nChapas usam
    // os valores CHEIOS, sem nenhum desconto.
    const contexto = contextoOffsetValido({ viraFolha: true });
    const params = paramsPrensaValidos({ torres: 4 });
    const pedido = pedidoOffsetValido({ quantidade: 400, corFrente: 4, corVerso: 1 });

    const resultado = calcularOffset(pedido, contexto, params);

    expect(resultado.nUp).toBe(4);
    // folhasBoas = ceil(400/4) = 100 (nUp inteiro, sem otimização).
    expect(resultado.folhasBoas).toBe(100);
    // nChapas = 4+1 = 5 (cheio, sem desconto — F≠V).
    expect(resultado.nChapas).toBe(5);
  });

  it("nUp ímpar não aplica a otimização — folhasBoas usa nUp inteiro mesmo com F===V e viraFolha=true", () => {
    // Peça 0,1×0,1 (quadrada — orientação não importa) → wLinha=hLinha=0,106.
    // Folha 0,2×0,4: lu=0,2-pinca(0,012)-2×margemLateral(0,01)=0,168 →
    // floor((0,168+0,002)/(0,106+0,002)) = floor(0,17/0,108) = 1.
    // au=0,4-2×0,01=0,38 → floor((0,38+0,002)/0,108) = floor(0,382/0,108) = 3.
    // nUp = 1×3 = 3 (ímpar).
    const contexto = contextoOffsetValido({
      viraFolha: true,
      folhas: [{ id: "folha-estreita", nome: "estreita", larguraFolha: 0.2, alturaFolha: 0.4 }],
    });
    const params = paramsPrensaValidos({ torres: 4 });
    const pedido = pedidoOffsetValido({ quantidade: 300, corFrente: 4, corVerso: 4, larguraM: 0.1, alturaM: 0.1 });

    const resultado = calcularOffset(pedido, contexto, params);

    expect(resultado.nUp % 2).toBe(1); // confirma a premissa do teste: nUp ímpar
    // folhasBoas = ceil(300/nUp) usando nUp CHEIO — sem divisão por 2.
    expect(resultado.folhasBoas).toBe(Math.ceil(300 / resultado.nUp));
    // nChapas = 4+4 = 8 (cheio — nUp ímpar não permite parear frente/verso).
    expect(resultado.nChapas).toBe(8);
  });
});

// Achado 5 da auditoria do motor M2/Offset (2026-09-12): a folha mais barata
// em PAPEL nem sempre é a mais barata no TOTAL — nUp decide se o desconto de
// work-and-turn vale e quantas folhas a rodagem cobra por entrada.
describe("calcularOffset — achado 5: escolhe a folha pelo custo-base completo, não só papel", () => {
  it("prefere a folha com nUp par (desconto de chapa) mesmo custando mais em papel isolado", () => {
    // Folha A: nUp ímpar, papel mais barato isolado. Folha B: nUp par
    // (permite o desconto de work-and-turn), papel um pouco mais caro
    // isolado — mas o total (papel+chapas+rodagem) de B é menor.
    const contexto = contextoOffsetValido({
      viraFolha: true,
      folhas: [
        // A: 0,3×0,7 → lu=0,278,au=0,678 → nUp = floor(0,28/0,208)×floor(0,68/0,208) = 1×3 = 3 (ímpar)
        { id: "folha-A", nome: "A (papel barato, nUp ímpar)", larguraFolha: 0.3, alturaFolha: 0.7 },
        // B: 0,5×0,5 → nUp=4 (par, mesma geometria do describe anterior)
        { id: "folha-B", nome: "B (papel caro, nUp par)", larguraFolha: 0.5, alturaFolha: 0.5 },
      ],
    });
    const params = paramsPrensaValidos({ torres: 4, custoChapa: 200 }); // custoChapa alto pra desconto pesar mais que a diferença de papel
    const pedido = pedidoOffsetValido({ quantidade: 400, corFrente: 4, corVerso: 4, larguraM: 0.1, alturaM: 0.1 });

    const resultado = calcularOffset(pedido, contexto, params);

    // Com custoChapa=200, o desconto de work-and-turn da folha B (4 chapas a
    // menos: 8→4, economia de 4×200=800) supera de sobra qualquer diferença
    // de custo de papel entre A (nUp=3) e B (nUp=4) — B tem que ser a
    // escolhida, mesmo que A tivesse papel mais barato isolado.
    expect(resultado.folhaEscolhida.id).toBe("folha-B");
  });
});
