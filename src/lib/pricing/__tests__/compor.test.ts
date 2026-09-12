import { describe, expect, it } from "vitest";
import { comporPreco, aplicarPisoDoPedido } from "../compor";
import { paraDecimal } from "../decimal";
import { ErroPrecificacao } from "../erros";
import type { ParametrosTenant } from "../tipos";

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

describe("comporPreco", () => {
  it("margem é aplicada por divisor, não por multiplicador", () => {
    const resultado = comporPreco({
      quantidade: 1,
      custoBase: paraDecimal(100),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0.2, impostoPercent: 0 },
    });
    // custoDireto=100, custoTotal=100, precoBruto = 100/(1-0.2) = 125, não 100*1.2=120
    expect(resultado.precoFinal.toNumber()).toBeCloseTo(125, 5);
  });

  it("rejeita configuração com soma de encargos >= 0.85", () => {
    expect(() =>
      comporPreco({
        quantidade: 1,
        custoBase: paraDecimal(100),
        parametros: { ...PARAMS, margemPadrao: 0.5, impostoPercent: 0.4 },
      })
    ).toThrow(ErroPrecificacao);
  });

  it("arredonda o preço final para cima no incremento comercial configurado", () => {
    const resultado = comporPreco({
      quantidade: 1,
      custoBase: paraDecimal(100),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0, impostoPercent: 0, incrementoArredondamento: 5 },
    });
    // custoDireto=100, sem encargos => precoBruto=100, arredonda pra cima em múltiplos de 5 => 100
    expect(resultado.precoFinal.toNumber()).toBe(100);
  });

  // Achado N3 da auditoria de abrangência — comporPreco NÃO aplica mais
  // pedidoMinimo por item (o piso agora é de PEDIDO, aplicado uma única vez
  // sobre a soma de todos os itens — ver aplicarPisoDoPedido mais abaixo e
  // recalcularTotalOrcamento em src/lib/orcamento-precificacao.ts). Preço da
  // linha reflete só o cálculo do item, mesmo com pedidoMinimo configurado
  // acima do preço calculado.
  it("NÃO aplica pedidoMinimo por item — preço da linha reflete só o cálculo do item", () => {
    const resultado = comporPreco({
      quantidade: 1,
      custoBase: paraDecimal(1),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0, impostoPercent: 0, pedidoMinimo: 50 },
    });
    // custoDireto=1, sem encargos => precoBruto=1, arredondado no incremento
    // padrão (0.1) => 1. pedidoMinimo=50 configurado, mas ignorado aqui.
    expect(resultado.precoFinal.toNumber()).toBe(1);
  });

  it("precoUnitario × quantidade bate com precoFinal mesmo quando a divisão não fecha redondo (evita item.precoUnitario × item.quantidade ≠ item.precoTotal depois de gravar em Decimal(12,2))", () => {
    const resultado = comporPreco({
      quantidade: 7,
      custoBase: paraDecimal(10),
      parametros: PARAMS,
    });

    // precoUnitario já deve sair arredondado pra 2 casas (fonte da verdade),
    // e precoFinal deve ser o unitário × quantidade — não uma divisão à parte.
    expect(resultado.precoUnitario.toNumber()).toBe(2.23);
    expect(resultado.precoFinal.toNumber()).toBe(15.61);

    // Simula o que o Postgres faz ao gravar cada coluna Decimal(12,2)
    // independentemente: arredonda as duas pra 2 casas e confere que ainda batem.
    const unitarioGravado = Number(resultado.precoUnitario.toFixed(2));
    const totalGravado = Number(resultado.precoFinal.toFixed(2));
    expect(Math.round(unitarioGravado * 7 * 100) / 100).toBe(totalGravado);
  });

  it("achado 4 da auditoria do motor M2/Offset (2026-09-12) — arredondamento do unitário nunca desfaz o ceil do incremento comercial", () => {
    // Sem encargos nenhum (overhead/margem/imposto/comissao/taxaFinanceira
    // todos 0) pra isolar só o arredondamento: precoBruto = custoDireto =
    // 12.34, incremento 0.1 → arredondarParaIncremento faz ceil(123.4)*0.1 =
    // 12.4 (precoFinalAlvo). Dividido por 100 unidades: 12.4/100 = 0.124 —
    // na 3ª casa decimal (4, abaixo de 5), o rounding padrão ROUND_HALF_UP
    // arredondaria pra BAIXO (0.12), e 0.12 × 100 = 12.00 fica ABAIXO do
    // alvo de 12.4 — exatamente o bug do achado 4. Com ROUND_UP, 0.124 vira
    // 0.13 (sempre pra cima), e 0.13 × 100 = 13.00 nunca fica abaixo do alvo.
    const resultado = comporPreco({
      quantidade: 100,
      custoBase: paraDecimal(12.34),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0, impostoPercent: 0, incrementoArredondamento: 0.1 },
    });

    expect(resultado.precoUnitario.toNumber()).toBe(0.13);
    expect(resultado.precoFinal.toNumber()).toBe(13);
    // A garantia que importa: nunca abaixo do alvo comercial arredondado (12.4).
    expect(resultado.precoFinal.toNumber()).toBeGreaterThanOrEqual(12.4);
  });

  it("custoCliche e custoFaca somam em custoDireto uma única vez, sem escalar com a quantidade", () => {
    const semExtras = comporPreco({
      quantidade: 1000,
      custoBase: paraDecimal(100),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0, impostoPercent: 0 },
    });
    const comExtras = comporPreco({
      quantidade: 1000,
      custoBase: paraDecimal(100),
      custoCliche: paraDecimal(40), // ex: 4 cores × R$10/clichê
      custoFaca: paraDecimal(60),
      parametros: { ...PARAMS, overheadPercent: 0, margemPadrao: 0, impostoPercent: 0 },
    });

    // custoDireto sobe exatamente 40+60=100, não 100×1000 (não escala com Q).
    expect(comExtras.custoDireto.toNumber()).toBe(semExtras.custoDireto.toNumber() + 100);
    expect(comExtras.detalhes.cliche.toNumber()).toBe(40);
    expect(comExtras.detalhes.faca.toNumber()).toBe(60);

    // Sem os params, os detalhes vêm zerados (nunca undefined) — mantém o
    // shape do breakdown estável entre orçamentos com e sem etiqueta.
    expect(semExtras.detalhes.cliche.toNumber()).toBe(0);
    expect(semExtras.detalhes.faca.toNumber()).toBe(0);
  });
});

// Achado N3 da auditoria de abrangência — piso de PEDIDO, aplicado uma única
// vez sobre a SOMA dos itens (não mais por item, ver describe acima). Ver
// recalcularTotalOrcamento em src/lib/orcamento-precificacao.ts pro ponto
// que efetivamente soma+aplica isto num orçamento de verdade.
describe("aplicarPisoDoPedido", () => {
  it("cenário da auditoria: 3 itens (R$12+R$9+R$4=R$25) com pedidoMinimo=30 → total R$30, não R$25 nem 3×30", () => {
    const somaItens = paraDecimal(12).plus(9).plus(4); // R$25
    const total = aplicarPisoDoPedido(somaItens, paraDecimal(30), paraDecimal(0.01));
    expect(total.toNumber()).toBe(30);
  });

  it("soma acima do mínimo não é alterada", () => {
    const somaItens = paraDecimal(100);
    const total = aplicarPisoDoPedido(somaItens, paraDecimal(30), paraDecimal(0.01));
    expect(total.toNumber()).toBe(100);
  });

  it("pedidoMinimo=0 (padrão, gráfica sem piso configurado) nunca altera a soma", () => {
    const somaItens = paraDecimal(3.5);
    const total = aplicarPisoDoPedido(somaItens, paraDecimal(0), paraDecimal(0.01));
    expect(total.toNumber()).toBe(3.5);
  });

  it("aplica o piso ANTES do arredondamento final, não depois — arredondamento nunca devolve valor abaixo do mínimo", () => {
    // pedidoMinimo=30 não é múltiplo do incremento comercial (7) — se o
    // arredondamento rodasse ANTES do piso (bug original do achado N3), o
    // resultado seria diferente de ceil(30/7)*7=35. Testa a ORDEM: piso
    // primeiro (soma 25 -> 30), depois arredonda (30 -> 35).
    const somaItens = paraDecimal(25);
    const total = aplicarPisoDoPedido(somaItens, paraDecimal(30), paraDecimal(7));
    expect(total.toNumber()).toBe(35);
    expect(total.toNumber()).toBeGreaterThanOrEqual(30);
  });
});
