import { describe, it, expect } from "vitest";
import { calcularProjecaoFluxoCaixa, type Transacao } from "./fluxo-caixa";

describe("calcularProjecaoFluxoCaixa", () => {
  // Helpers
  // criarData(N) retorna uma Data N dias a partir de hoje (N=1 = amanhã)
  function criarData(diasDesdeHoje: number): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + diasDesdeHoje);
    return d;
  }

  it("caso vazio: sem transações, saldo constante", () => {
    const resultado = calcularProjecaoFluxoCaixa(1000, [], []);

    expect(resultado.buckets).toHaveLength(6); // 4 semanas + 2 meses
    expect(resultado.buckets[0]).toMatchObject({
      rotulo: "Semana 1",
      entradas: 0,
      saidas: 0,
      saldoAcumulado: 1000,
    });
    expect(resultado.buckets[5]).toMatchObject({
      rotulo: "Mês 3",
      entradas: 0,
      saidas: 0,
      saldoAcumulado: 1000,
    });
    expect(resultado.dataFicaNegativo).toBeNull();
    expect(resultado.diasAteNegativo).toBeNull();
  });

  it("simples: uma entrada na semana 1, saldo positivo", () => {
    const cr: Transacao[] = [
      { vencimento: criarData(3), valor: 500 }, // Dia 3 = metade da semana 1
    ];

    const resultado = calcularProjecaoFluxoCaixa(100, cr, []);

    expect(resultado.buckets[0]).toMatchObject({
      rotulo: "Semana 1",
      entradas: 500,
      saidas: 0,
      saldoAcumulado: 600,
    });
    expect(resultado.dataFicaNegativo).toBeNull();
  });

  it("simples: uma saída na semana 1, saldo positivo", () => {
    const despesas: Transacao[] = [
      { vencimento: criarData(2), valor: 100 },
    ];

    const resultado = calcularProjecaoFluxoCaixa(500, [], despesas);

    expect(resultado.buckets[0]).toMatchObject({
      rotulo: "Semana 1",
      entradas: 0,
      saidas: 100,
      saldoAcumulado: 400,
    });
    expect(resultado.dataFicaNegativo).toBeNull();
  });

  it("detecta negatividade: despesa maior que saldo", () => {
    const despesas: Transacao[] = [
      { vencimento: criarData(2), valor: 200 },
    ];

    const resultado = calcularProjecaoFluxoCaixa(50, [], despesas);

    expect(resultado.buckets[0]).toMatchObject({
      rotulo: "Semana 1",
      entradas: 0,
      saidas: 200,
      saldoAcumulado: -150,
    });
    expect(resultado.dataFicaNegativo).not.toBeNull();
    expect(resultado.diasAteNegativo).toBe(2); // Dia 2 = offset 2
  });

  it("acumula saldo entre buckets", () => {
    const cr: Transacao[] = [
      { vencimento: criarData(5), valor: 1000 }, // Semana 1
      { vencimento: criarData(20), valor: 500 }, // Semana 3
    ];
    const despesas: Transacao[] = [
      { vencimento: criarData(3), valor: 100 }, // Semana 1
    ];

    const resultado = calcularProjecaoFluxoCaixa(100, cr, despesas);

    expect(resultado.buckets[0]).toMatchObject({
      rotulo: "Semana 1",
      entradas: 1000,
      saidas: 100,
      saldoAcumulado: 1000, // 100 + 1000 - 100
    });
    expect(resultado.buckets[2]).toMatchObject({
      rotulo: "Semana 3",
      entradas: 500,
      saidas: 0,
      saldoAcumulado: 1500, // 1000 + 500
    });
  });

  it("múltiplas transações no mesmo dia agregam corretamente", () => {
    const cr: Transacao[] = [
      { vencimento: criarData(1), valor: 300 },
      { vencimento: criarData(1), valor: 200 },
    ];
    const despesas: Transacao[] = [
      { vencimento: criarData(1), valor: 100 },
      { vencimento: criarData(1), valor: 50 },
    ];

    const resultado = calcularProjecaoFluxoCaixa(0, cr, despesas);

    expect(resultado.buckets[0]).toMatchObject({
      rotulo: "Semana 1",
      entradas: 500, // 300 + 200
      saidas: 150, // 100 + 50
      saldoAcumulado: 350,
    });
  });

  it("transações após 90 dias são ignoradas", () => {
    const cr: Transacao[] = [
      { vencimento: criarData(45), valor: 500 },
      { vencimento: criarData(91), valor: 1000 }, // Fora do horizonte
    ];

    const resultado = calcularProjecaoFluxoCaixa(0, cr, []);

    // Dia 45 cai em Mês 2 (dias 29-58), que é buckets[4]
    expect(resultado.buckets[4]).toMatchObject({
      rotulo: "Mês 2",
      entradas: 500,
    });
    // O saldo final é 500, não 1500
    expect(resultado.buckets[5].saldoAcumulado).toBe(500);
  });

  it("detecta negatividade em dia específico dentro do período", () => {
    const despesas: Transacao[] = [
      { vencimento: criarData(1), valor: 1000 },
    ];

    const resultado = calcularProjecaoFluxoCaixa(500, [], despesas);

    expect(resultado.dataFicaNegativo).not.toBeNull();
    expect(resultado.diasAteNegativo).toBe(1); // Dia 1 = offset 1
  });

  it("mês 2 e mês 3 bucketizam corretamente", () => {
    const cr: Transacao[] = [
      { vencimento: criarData(10), valor: 100 }, // Semana 2
      { vencimento: criarData(35), valor: 200 }, // Mês 2 (dia 35)
      { vencimento: criarData(70), valor: 300 }, // Mês 3 (dia 70)
    ];

    const resultado = calcularProjecaoFluxoCaixa(0, cr, []);

    expect(resultado.buckets).toHaveLength(6);
    // buckets[0-3] = Semana 1-4, buckets[4-5] = Mês 2-3
    expect(resultado.buckets[4]).toMatchObject({
      rotulo: "Mês 2",
      entradas: 200,
    });
    expect(resultado.buckets[5]).toMatchObject({
      rotulo: "Mês 3",
      entradas: 300,
    });
  });

  it("saldo acumulado cresce/diminui corretamente ao longo do período", () => {
    const cr: Transacao[] = [
      { vencimento: criarData(5), valor: 1000 },
      { vencimento: criarData(35), valor: 500 },
      { vencimento: criarData(65), valor: 200 },
    ];
    const despesas: Transacao[] = [
      { vencimento: criarData(10), valor: 300 },
      { vencimento: criarData(40), valor: 200 },
    ];

    const resultado = calcularProjecaoFluxoCaixa(100, cr, despesas);

    // Semana 1: 100 + 1000 - 0 = 1100
    expect(resultado.buckets[0].saldoAcumulado).toBe(1100);
    // Semana 2: 1100 + 0 - 300 = 800
    expect(resultado.buckets[1].saldoAcumulado).toBe(800);
    // Mês 2 (buckets[4]): 800 + 500 - 200 = 1100
    expect(resultado.buckets[4].saldoAcumulado).toBe(1100);
    // Mês 3 (buckets[5]): 1100 + 200 - 0 = 1300
    expect(resultado.buckets[5].saldoAcumulado).toBe(1300);
  });

  it("registra negatividade apenas uma vez (na primeira ocorrência)", () => {
    const despesas: Transacao[] = [
      { vencimento: criarData(2), valor: 1000 },
      { vencimento: criarData(3), valor: 500 }, // Continuaria negativo
    ];

    const resultado = calcularProjecaoFluxoCaixa(100, [], despesas);

    // Deve registrar a primeira data (dia 2)
    expect(resultado.dataFicaNegativo).not.toBeNull();
    expect(resultado.diasAteNegativo).toBe(2); // Dia 2 = offset 2
  });

  it("conta já vencida (vencimento no passado) não some da projeção — conta na Semana 1", () => {
    const despesas: Transacao[] = [
      { vencimento: criarData(-10), valor: 800 }, // vencida há 10 dias
    ];

    const resultado = calcularProjecaoFluxoCaixa(500, [], despesas);

    expect(resultado.buckets[0]).toMatchObject({
      rotulo: "Semana 1",
      saidas: 800,
      saldoAcumulado: -300,
    });
    expect(resultado.dataFicaNegativo).not.toBeNull();
    // Saldo final (Mês 3) também reflete a dívida vencida, não só a Semana 1.
    expect(resultado.buckets[5].saldoAcumulado).toBe(-300);
  });

  it("recuperação após negatividade continua registrando", () => {
    const cr: Transacao[] = [
      { vencimento: criarData(5), valor: 5000 }, // Recupera após despesa
    ];
    const despesas: Transacao[] = [
      { vencimento: criarData(1), valor: 2000 },
    ];

    const resultado = calcularProjecaoFluxoCaixa(100, cr, despesas);

    // Fica negativo no dia 1 (offset 1): -1900
    expect(resultado.dataFicaNegativo).not.toBeNull();
    expect(resultado.diasAteNegativo).toBe(1);
    // Mas semana 1 termina positiva: 100 - 2000 + 5000 = 3100
    expect(resultado.buckets[0].saldoAcumulado).toBe(3100);
  });
});
