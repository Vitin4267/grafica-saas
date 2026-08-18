import { describe, expect, it } from "vitest";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import type { ParametrosTenant } from "../tipos";

// Mesma fixture de golden.test.ts — o que importa é o COMPORTAMENTO relativo
// (clichê fixo por cor, material variando com o papel), não bater centavo
// com uma tabela real.
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

function contextoEtiqueta(overrides: Partial<ContextoPrecificacao> = {}): ContextoPrecificacao {
  return {
    itemGraficaId: "etiqueta-rolo",
    modeloCalculo: "M2",
    viraFolha: false,
    parametros: PARAMS,
    m2: {
      bobinas: [{ id: "bobina-1.00", larguraNominal: 1.0, refile: 0.02 }],
      custoM2Material: 3.4, // ex: papel Couchê Borracha Titi/Arclad
      custoImpressaoM2: 6,
      areaMinimaFaturavel: 0.1,
    },
    ...overrides,
  };
}

function pedidoEtiqueta(quantidade: number): PedidoPrecificacao {
  return {
    tipo: "M2",
    pedido: { larguraM: 0.05, alturaM: 0.05, quantidade },
    acabamentos: [],
  };
}

describe("motor de clichê de etiqueta — por área e por cor, papel variável", () => {
  it("custo de clichê é IDÊNTICO em tiragens bem diferentes (por área×cor, não por quantidade)", () => {
    // Etiqueta 5×5cm = 25cm². 4 cores × R$1,00/cm² × 25cm² = R$100.
    const etiquetaCliche = { quantidadeCores: 4, custoClichePorCm2: 1 };

    const resultadoPequeno = precificar(
      pedidoEtiqueta(100),
      contextoEtiqueta({ etiquetaCliche })
    );
    const resultadoGrande = precificar(
      pedidoEtiqueta(50_000),
      contextoEtiqueta({ etiquetaCliche })
    );

    // Igual nos dois, mesmo com tiragem 500× maior — a prova central do requisito.
    expect(resultadoPequeno.detalhes.cliche.toNumber()).toBe(100);
    expect(resultadoGrande.detalhes.cliche.toNumber()).toBe(100);
  });

  it("etiqueta maior (mais área) custa mais clichê, mesmo nº de cores e mesma taxa por cm²", () => {
    const etiquetaCliche = { quantidadeCores: 2, custoClichePorCm2: 1 };
    function pedidoTamanho(larguraM: number, alturaM: number): PedidoPrecificacao {
      return { tipo: "M2", pedido: { larguraM, alturaM, quantidade: 1000 }, acabamentos: [] };
    }

    const pequena = precificar(pedidoTamanho(0.05, 0.05), contextoEtiqueta({ etiquetaCliche })); // 25cm²
    const grande = precificar(pedidoTamanho(0.1, 0.1), contextoEtiqueta({ etiquetaCliche })); // 100cm²

    // 2 cores × R$1/cm² × área — escala 4x junto com a área (25→100cm²).
    expect(pequena.detalhes.cliche.toNumber()).toBe(50); // 2×1×25
    expect(grande.detalhes.cliche.toNumber()).toBe(200); // 2×1×100
  });

  it("troca de papel (custoM2Material) muda o preço final proporcionalmente ao material, sem mexer no clichê", () => {
    const etiquetaCliche = { quantidadeCores: 2, custoClichePorCm2: 20 };

    const papelBarato = precificar(
      pedidoEtiqueta(1000),
      contextoEtiqueta({
        etiquetaCliche,
        m2: {
          bobinas: [{ id: "b1", larguraNominal: 1.0, refile: 0.02 }],
          custoM2Material: 2.16, // ex: L2 - 150g
          custoImpressaoM2: 6,
          areaMinimaFaturavel: 0.1,
        },
      })
    );
    const papelCaro = precificar(
      pedidoEtiqueta(1000),
      contextoEtiqueta({
        etiquetaCliche,
        m2: {
          bobinas: [{ id: "b1", larguraNominal: 1.0, refile: 0.02 }],
          custoM2Material: 5.4, // ex: Bopp branco fosco borracha
          custoImpressaoM2: 6,
          areaMinimaFaturavel: 0.1,
        },
      })
    );

    // Clichê não muda com o papel — só o material.
    expect(papelBarato.detalhes.cliche.toNumber()).toBe(papelCaro.detalhes.cliche.toNumber());
    expect(papelCaro.detalhes.material.toNumber()).toBeGreaterThan(
      papelBarato.detalhes.material.toNumber()
    );
    expect(papelCaro.precoFinal.toNumber()).toBeGreaterThan(papelBarato.precoFinal.toNumber());
  });

  it("custoFaca e custoFreteEstimado somam uma vez, fora do custoBase (mesmo item, com e sem eles)", () => {
    const semExtras = precificar(pedidoEtiqueta(500), contextoEtiqueta());
    const comExtras = precificar(
      pedidoEtiqueta(500),
      contextoEtiqueta({ custoFaca: 150, custoFreteEstimado: 80 })
    );

    expect(comExtras.custoDireto.toNumber()).toBeCloseTo(
      semExtras.custoDireto.toNumber() + 150 + 80,
      6
    );
    expect(comExtras.detalhes.faca.toNumber()).toBe(150);
    expect(comExtras.detalhes.frete.toNumber()).toBe(80);
  });
});
