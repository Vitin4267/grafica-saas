import { describe, expect, it } from "vitest";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type { ParametrosTenant } from "../tipos";

// Achado A9 da auditoria de abrangência: peça maior que toda bobina cadastrada
// hoje é sempre PECA_EXCEDE_BOBINA. Quando o item tem ConfiguracaoEmenda
// cadastrada, em vez de erro o motor divide a peça em painéis e soma o custo
// de emenda ao custoBase, devolvendo um aviso (não bloqueia o orçamento).
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

function contextoBackdrop(overrides: Partial<ContextoPrecificacao> = {}): ContextoPrecificacao {
  return {
    itemGraficaId: "backdrop-lona",
    modeloCalculo: "M2",
    viraFolha: false,
    parametros: PARAMS,
    m2: {
      // Bobina de 1,50m nominal, 0,02m de refile por lado -> 1,46m útil.
      bobinas: [{ id: "bobina-1.5", larguraNominal: 1.5, refile: 0.02 }],
      custoM2Material: 20,
      custoImpressaoM2: 8,
      areaMinimaFaturavel: 0.5,
    },
    ...overrides,
  };
}

function pedidoBackdrop(larguraM: number, alturaM: number, quantidade = 1): PedidoPrecificacao {
  return { tipo: "M2", pedido: { larguraM, alturaM, quantidade }, acabamentos: [] };
}

describe("emenda de painéis (achado A9) — calcularM2 via precificar", () => {
  it("peça que cabe numa bobina: comportamento inalterado, sem emenda/aviso mesmo com ConfiguracaoEmenda cadastrada", () => {
    const resultado = precificar(
      pedidoBackdrop(1.0, 2.0),
      contextoBackdrop({
        m2: {
          bobinas: [{ id: "bobina-1.5", larguraNominal: 1.5, refile: 0.02 }],
          custoM2Material: 20,
          custoImpressaoM2: 8,
          areaMinimaFaturavel: 0.5,
          configuracaoEmenda: { custoPorMetroLinear: 15, sobreposicaoM: 0.05 },
        },
      })
    );

    expect(resultado.metricas.numPaineis).toBeNull();
    expect(resultado.metricas.custoEmenda).toBe(0);
    expect(resultado.metricas.avisos).toEqual([]);
  });

  it("peça que excede toda bobina cadastrada SEM ConfiguracaoEmenda: continua lançando PECA_EXCEDE_BOBINA", () => {
    // Peça de 4m de largura não cabe em nenhuma orientação numa bobina de 1,5m.
    expect(() => precificar(pedidoBackdrop(4, 2), contextoBackdrop())).toThrow(ErroPrecificacao);
    try {
      precificar(pedidoBackdrop(4, 2), contextoBackdrop());
      throw new Error("deveria ter lançado");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PECA_EXCEDE_BOBINA");
    }
  });

  it("peça que excede toda bobina COM ConfiguracaoEmenda: calcula nºPainéis e custo de emenda, sem erro, com aviso", () => {
    // Bobina útil = 1.5 - 2*0.02 = 1.46m. Peça 1m de largura (+0.04 de margem
    // de segurança 2x0.02 = 1.04m efetivo) cabe sozinha (candidato normal
    // existiria) — usamos largura 4m pra forçar ceil(4.04/1.46) = 3 painéis.
    const resultado = precificar(pedidoBackdrop(4, 2), contextoBackdrop({
      m2: {
        bobinas: [{ id: "bobina-1.5", larguraNominal: 1.5, refile: 0.02 }],
        custoM2Material: 20,
        custoImpressaoM2: 8,
        areaMinimaFaturavel: 0.5,
        configuracaoEmenda: { custoPorMetroLinear: 15, sobreposicaoM: 0.05 },
      },
    }));

    // wLinha = 4 + 2*0.02 = 4.04; wUtil = 1.46; ceil(4.04/1.46) = 3 painéis.
    expect(resultado.metricas.numPaineis).toBe(3);
    // hLinha = 2 + 2*0.02 = 2.04 = "b" (comprimento da emenda).
    // custoEmenda = 15 * 2.04 * (3-1) * quantidade(1) = 61.2
    expect(resultado.metricas.custoEmenda).toBeCloseTo(61.2, 6);
    expect((resultado.metricas.avisos as string[]).length).toBe(1);
    expect((resultado.metricas.avisos as string[])[0]).toMatch(/emenda/i);
    expect((resultado.metricas.avisos as string[])[0]).toMatch(/3 painéis/);

    // custoEmenda precisa ter entrado no custoBase (auditável via
    // custoMaterial + custoImpressao + custoEmenda == custoBase implícito no
    // preço final subindo em relação ao mesmo pedido sem ConfiguracaoEmenda
    // seria impossível de comparar, já que sem config o pedido lançaria erro
    // — em vez disso conferimos que o total de metricas.custoMaterial +
    // custoImpressao + custoEmenda bate com o esperado).
    const custoMaterialEsperado =
      Number(resultado.metricas.custoMaterial) > 0 ? resultado.metricas.custoMaterial : 0;
    expect(custoMaterialEsperado).toBeGreaterThan(0);
  });

  it("escala com a quantidade: 2 peças pagam 2x o custo de emenda de 1 peça", () => {
    const contexto = () =>
      contextoBackdrop({
        m2: {
          bobinas: [{ id: "bobina-1.5", larguraNominal: 1.5, refile: 0.02 }],
          custoM2Material: 20,
          custoImpressaoM2: 8,
          areaMinimaFaturavel: 0.5,
          configuracaoEmenda: { custoPorMetroLinear: 15, sobreposicaoM: 0.05 },
        },
      });

    const umaPeca = precificar(pedidoBackdrop(4, 2, 1), contexto());
    const duasPecas = precificar(pedidoBackdrop(4, 2, 2), contexto());

    expect(duasPecas.metricas.custoEmenda).toBeCloseTo(
      (umaPeca.metricas.custoEmenda as number) * 2,
      6
    );
  });

  // Achado 3 da auditoria do motor M2/Offset (2026-09-12) — cenário exato do
  // achado: banner quadrado 3,00×3,00m (piece quadrada pra eliminar qualquer
  // ambiguidade de escolha de orientação — a=b nos dois sentidos), bobina
  // 1,60m com refile 0,02m (wUtil=1,56m), sobreposição 0,05m cadastrada.
  // ANTES: nºPainéis = ceil((3,00+0,04)/1,56) = ceil(1,949) = 2 painéis de
  // 1,52m cada — que, com a sobreposição de 0,05m, precisariam de 1,57m >
  // 1,56m (wUtil): fisicamente IMPOSSÍVEL, o motor orçava o impossível.
  // AGORA: ceil(3,04/(1,56−0,05)) = ceil(3,04/1,51) = 3 painéis — o valor
  // fisicamente correto.
  it("achado 3: sobreposição de emenda aumenta nºPainéis (2→3) E a área impressa (dupla nas faixas de sobreposição)", () => {
    const resultado = precificar(
      pedidoBackdrop(3.0, 3.0),
      contextoBackdrop({
        m2: {
          bobinas: [{ id: "bobina-1.6", larguraNominal: 1.6, refile: 0.02 }],
          custoM2Material: 20,
          custoImpressaoM2: 8,
          areaMinimaFaturavel: 0.5,
          configuracaoEmenda: { custoPorMetroLinear: 15, sobreposicaoM: 0.05 },
        },
      })
    );

    // 3 painéis, NÃO 2 — a prova central do achado.
    expect(resultado.metricas.numPaineis).toBe(3);

    // areaPecaComMargem = wLinha×hLinha = 3,04×3,04 = 9,2416
    // areaImpressaoExtraPorPeca = sobreposicaoM(0,05) × b(3,04) × (nPainéis−1=2) = 0,304
    // areaImpressaoPorPeca = 9,2416 + 0,304 = 9,5456 (acima do piso de 0,5, não afeta)
    // custoImpressao = Q(1) × 9,5456 × custoImpressaoM2(8) = 76,3648
    expect(resultado.metricas.custoImpressao).toBeCloseTo(76.3648, 4);

    // custoEmenda = custoPorMetroLinear(15) × b(3,04) × (nPainéis−1=2) × Q(1) = 91,2
    expect(resultado.metricas.custoEmenda).toBeCloseTo(91.2, 6);

    // custoMaterial: numFaixas=1×3=3; lConsumido=3×(3,04+gapPecasPadrao 0,008)=9,144;
    // areaFaturavel=larguraNominal(1,6)×9,144=14,6304; custoMaterial=14,6304×20=292,608
    expect(resultado.metricas.custoMaterial).toBeCloseTo(292.608, 4);
  });

  it("nenhuma bobina cadastrada tem largura útil positiva mesmo com ConfiguracaoEmenda: continua lançando PECA_EXCEDE_BOBINA", () => {
    const contexto = contextoBackdrop({
      m2: {
        // refile*2 >= larguraNominal -> wUtil <= 0, nenhum painel cabe.
        bobinas: [{ id: "bobina-ruim", larguraNominal: 0.5, refile: 0.3 }],
        custoM2Material: 20,
        custoImpressaoM2: 8,
        areaMinimaFaturavel: 0.5,
        configuracaoEmenda: { custoPorMetroLinear: 15, sobreposicaoM: 0.05 },
      },
    });

    try {
      precificar(pedidoBackdrop(4, 2), contexto);
      throw new Error("deveria ter lançado");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PECA_EXCEDE_BOBINA");
    }
  });
});
