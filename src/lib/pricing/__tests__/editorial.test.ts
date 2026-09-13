import { describe, expect, it } from "vitest";
import { calcularEditorial } from "../editorial";
import { precificar, type PedidoPrecificacao, type ContextoPrecificacao } from "../precificar";
import { ErroPrecificacao } from "../erros";
import type { ContextoEditorial, ParametrosTenant, PedidoEditorial } from "../tipos";

// Achado A10 (rota 1) da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md, Parte 1, 2026-09-06): editorial multipágina — Revista,
// Catálogo, Livro Brochura, Livro Capa Dura, Apostila, Encadernação
// Espiral, Wire-o. custoBase = custoMiolo (papel + impressão, função do nº
// de CADERNOS) + custoCapa (papel + impressão, função da área da capa
// aberta) + custoEncadernacao (fixo por peça).

function pedidoEditorialValido(overrides: Partial<PedidoEditorial> = {}): PedidoEditorial {
  return {
    quantidade: 100,
    numeroPaginas: 96, // múltiplo exato de 16 = 6 cadernos, sem arredondamento
    larguraM: 0.15,
    alturaM: 0.21, // A5-ish
    ...overrides,
  };
}

function contextoEditorialValido(overrides: Partial<ContextoEditorial> = {}): ContextoEditorial {
  return {
    gramaturaMioloGm2: 90,
    precoPorKgMiolo: 8,
    gramaturaCapaGm2: 250,
    precoPorKgCapa: 12,
    custoImpressaoM2: 2,
    custoEncadernacaoPorPeca: 3,
    paginasPorCaderno: 16,
    ...overrides,
  };
}

describe("calcularEditorial — cálculo de cadernos", () => {
  it("96 páginas com caderno de 16 → exatamente 6 cadernos, sem arredondamento", () => {
    const resultado = calcularEditorial(
      pedidoEditorialValido({ numeroPaginas: 96 }),
      contextoEditorialValido({ paginasPorCaderno: 16 })
    );
    expect(resultado.numeroCadernos).toBe(6);
    expect(resultado.paginasEfetivas).toBe(96);
  });

  it("100 páginas com caderno de 16 → arredonda pra CIMA (7 cadernos = 112 páginas efetivas), nunca trunca perdendo páginas", () => {
    const resultado = calcularEditorial(
      pedidoEditorialValido({ numeroPaginas: 100 }),
      contextoEditorialValido({ paginasPorCaderno: 16 })
    );
    // ceil(100/16) = ceil(6.25) = 7
    expect(resultado.numeroCadernos).toBe(7);
    expect(resultado.paginasEfetivas).toBe(112);
    expect(resultado.paginasEfetivas).toBeGreaterThanOrEqual(100);
  });

  it("1 página além de um múltiplo exato ainda soma 1 caderno inteiro (17 páginas, caderno 16 → 2 cadernos)", () => {
    const resultado = calcularEditorial(
      pedidoEditorialValido({ numeroPaginas: 17 }),
      contextoEditorialValido({ paginasPorCaderno: 16 })
    );
    expect(resultado.numeroCadernos).toBe(2);
    expect(resultado.paginasEfetivas).toBe(32);
  });

  it("respeita paginasPorCaderno configurado diferente de 16 (ex: 32)", () => {
    const resultado = calcularEditorial(
      pedidoEditorialValido({ numeroPaginas: 40 }),
      contextoEditorialValido({ paginasPorCaderno: 32 })
    );
    // ceil(40/32) = 2 → 64 páginas efetivas
    expect(resultado.numeroCadernos).toBe(2);
    expect(resultado.paginasEfetivas).toBe(64);
  });
});

describe("calcularEditorial — custo básico: miolo + capa + encadernação", () => {
  it("soma custoPapelMiolo + custoImpressaoMiolo + custoPapelCapa + custoImpressaoCapa + custoEncadernacao", () => {
    const resultado = calcularEditorial(
      pedidoEditorialValido({ quantidade: 100, numeroPaginas: 96, larguraM: 0.15, alturaM: 0.21 }),
      contextoEditorialValido({
        gramaturaMioloGm2: 90,
        precoPorKgMiolo: 8,
        gramaturaCapaGm2: 250,
        precoPorKgCapa: 12,
        custoImpressaoM2: 2,
        custoEncadernacaoPorPeca: 3,
        paginasPorCaderno: 16,
      })
    );

    // 96 páginas efetivas → 48 folhas de miolo
    // areaPagina = 0.15 × 0.21 = 0.0315 m²
    // pesoMioloKg (por exemplar) = 48 × 0.0315 × 90 / 1000 = 0.13608 kg
    const areaPagina = 0.15 * 0.21;
    const pesoMioloPorExemplar = 48 * areaPagina * 90 / 1000;
    expect(resultado.pesoMioloKg.toNumber()).toBeCloseTo(pesoMioloPorExemplar, 6);

    const custoPapelMioloEsperado = pesoMioloPorExemplar * 8 * 100;
    expect(resultado.custoPapelMiolo.toNumber()).toBeCloseTo(custoPapelMioloEsperado, 4);

    const custoImpressaoMioloEsperado = 96 * areaPagina * 2 * 100;
    expect(resultado.custoImpressaoMiolo.toNumber()).toBeCloseTo(custoImpressaoMioloEsperado, 4);

    // capa: sem orelhas — largura efetiva = 2 × 0.15 = 0.30m
    const areaCapa = 0.15 * 2 * 0.21;
    expect(resultado.areaCapaM2.toNumber()).toBeCloseTo(areaCapa, 6);
    const pesoCapaPorExemplar = (areaCapa * 250) / 1000;
    const custoPapelCapaEsperado = pesoCapaPorExemplar * 12 * 100;
    expect(resultado.custoPapelCapa.toNumber()).toBeCloseTo(custoPapelCapaEsperado, 4);
    const custoImpressaoCapaEsperado = areaCapa * 2 * 100;
    expect(resultado.custoImpressaoCapa.toNumber()).toBeCloseTo(custoImpressaoCapaEsperado, 4);

    const custoEncadernacaoEsperado = 3 * 100;
    expect(resultado.custoEncadernacao.toNumber()).toBeCloseTo(custoEncadernacaoEsperado, 4);

    const custoBaseEsperado =
      custoPapelMioloEsperado +
      custoImpressaoMioloEsperado +
      custoPapelCapaEsperado +
      custoImpressaoCapaEsperado +
      custoEncadernacaoEsperado;
    expect(resultado.custoBase.toNumber()).toBeCloseTo(custoBaseEsperado, 4);
  });

  it("encadernação é fixa por peça — dobrar a quantidade dobra custoEncadernacao exatamente", () => {
    const q100 = calcularEditorial(pedidoEditorialValido({ quantidade: 100 }), contextoEditorialValido());
    const q200 = calcularEditorial(pedidoEditorialValido({ quantidade: 200 }), contextoEditorialValido());
    expect(q200.custoEncadernacao.toNumber()).toBeCloseTo(q100.custoEncadernacao.toNumber() * 2, 6);
  });

  it("orelhas aumentam a largura (e portanto a área/custo) da capa", () => {
    const semOrelha = calcularEditorial(
      pedidoEditorialValido({ temOrelhas: false }),
      contextoEditorialValido()
    );
    const comOrelha = calcularEditorial(
      pedidoEditorialValido({ temOrelhas: true, larguraOrelhaM: 0.08 }),
      contextoEditorialValido()
    );

    // largura efetiva sem orelha = 2×0.15 = 0.30; com orelha = 0.30 + 2×0.08 = 0.46
    expect(comOrelha.areaCapaM2.toNumber()).toBeCloseTo(0.46 * 0.21, 6);
    expect(comOrelha.custoPapelCapa.toNumber()).toBeGreaterThan(semOrelha.custoPapelCapa.toNumber());
    expect(comOrelha.custoImpressaoCapa.toNumber()).toBeGreaterThan(semOrelha.custoImpressaoCapa.toNumber());
  });

  it("miolo e capa em papéis/gramaturas diferentes calculam com preços independentes", () => {
    const resultado = calcularEditorial(
      pedidoEditorialValido(),
      contextoEditorialValido({
        gramaturaMioloGm2: 70,
        precoPorKgMiolo: 6,
        gramaturaCapaGm2: 300,
        precoPorKgCapa: 15,
      })
    );
    // Preços/gramaturas diferentes não devem colidir — capa mais pesada e
    // mais cara por kg custa proporcionalmente mais que o miolo, por área
    // equivalente.
    expect(resultado.custoPapelCapa.toNumber()).toBeGreaterThan(0);
    expect(resultado.custoPapelMiolo.toNumber()).toBeGreaterThan(0);
  });
});

describe("calcularEditorial — achado A5 da auditoria do motor de preço (2026-09-13): paginasPorCaderno precisa ser múltiplo de 4", () => {
  it("NUMERO_PAGINAS_INVALIDO quando paginasPorCaderno não é múltiplo de 4 (ex: 2, o erro clássico de ler 'por caderno' como 'por folha')", () => {
    for (const paginasPorCaderno of [2, 3, 6, 10, 15, 17]) {
      try {
        calcularEditorial(pedidoEditorialValido(), contextoEditorialValido({ paginasPorCaderno }));
        expect.fail("deveria ter lançado ErroPrecificacao");
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroPrecificacao);
        expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_PAGINAS_INVALIDO");
      }
    }
  });

  it("aceita múltiplos de 4 (4, 8, 16, 32)", () => {
    for (const paginasPorCaderno of [4, 8, 16, 32]) {
      const resultado = calcularEditorial(
        pedidoEditorialValido(),
        contextoEditorialValido({ paginasPorCaderno })
      );
      expect(resultado.custoBase.toNumber()).toBeGreaterThan(0);
    }
  });
});

describe("calcularEditorial — rejeições (ErroPrecificacao)", () => {
  it("NUMERO_PAGINAS_INVALIDO quando numeroPaginas é zero, negativo ou fracionário", () => {
    for (const numeroPaginas of [0, -10, 5.5]) {
      try {
        calcularEditorial(pedidoEditorialValido({ numeroPaginas }), contextoEditorialValido());
        expect.fail("deveria ter lançado ErroPrecificacao");
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroPrecificacao);
        expect((erro as ErroPrecificacao).codigo).toBe("NUMERO_PAGINAS_INVALIDO");
      }
    }
  });

  it("PAPEL_MIOLO_NAO_CONFIGURADO quando precoPorKgMiolo <= 0", () => {
    try {
      calcularEditorial(pedidoEditorialValido(), contextoEditorialValido({ precoPorKgMiolo: 0 }));
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PAPEL_MIOLO_NAO_CONFIGURADO");
    }
  });

  it("PAPEL_CAPA_NAO_CONFIGURADO quando precoPorKgCapa <= 0", () => {
    try {
      calcularEditorial(pedidoEditorialValido(), contextoEditorialValido({ precoPorKgCapa: 0 }));
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PAPEL_CAPA_NAO_CONFIGURADO");
    }
  });

  it("DIMENSAO_INVALIDA quando temOrelhas=true mas larguraOrelhaM está ausente ou <= 0", () => {
    for (const larguraOrelhaM of [undefined, 0, -1]) {
      try {
        calcularEditorial(
          pedidoEditorialValido({ temOrelhas: true, larguraOrelhaM }),
          contextoEditorialValido()
        );
        expect.fail("deveria ter lançado ErroPrecificacao");
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroPrecificacao);
        expect((erro as ErroPrecificacao).codigo).toBe("DIMENSAO_INVALIDA");
      }
    }
  });

  it("QUANTIDADE_INVALIDA quando a quantidade é zero ou não inteira", () => {
    try {
      calcularEditorial(pedidoEditorialValido({ quantidade: 0 }), contextoEditorialValido());
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("QUANTIDADE_INVALIDA");
    }
  });

  it("DIMENSAO_INVALIDA quando largura ou altura da página é zero", () => {
    try {
      calcularEditorial(pedidoEditorialValido({ larguraM: 0 }), contextoEditorialValido());
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("DIMENSAO_INVALIDA");
    }
  });
});

describe("calcularEditorial — achado C1 da auditoria do motor de preço (2026-09-13): faixa de gramatura (mesmo gêmeo do OFFSET)", () => {
  it("GRAMATURA_INVALIDA quando gramaturaMioloGm2 está fora da faixa default 30-500 (dedo-gordo: 9 em vez de 90)", () => {
    try {
      calcularEditorial(pedidoEditorialValido(), contextoEditorialValido({ gramaturaMioloGm2: 9 }));
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("GRAMATURA_INVALIDA");
    }
  });

  it("GRAMATURA_INVALIDA quando gramaturaMioloGm2 excede o teto default (900 em vez de 90)", () => {
    try {
      calcularEditorial(pedidoEditorialValido(), contextoEditorialValido({ gramaturaMioloGm2: 900 }));
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("GRAMATURA_INVALIDA");
    }
  });

  it("GRAMATURA_INVALIDA quando gramaturaCapaGm2 está fora da faixa — mesmo buraco, mesmo caminho, do lado da capa", () => {
    try {
      calcularEditorial(pedidoEditorialValido(), contextoEditorialValido({ gramaturaCapaGm2: 5 }));
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("GRAMATURA_INVALIDA");
    }
  });

  it("respeita a faixa configurável por gráfica (ParametrosGrafica.gramaturaMinGm2/gramaturaMaxGm2) em vez do default", () => {
    // Uma gráfica de cartonagem com faixa alargada (10-900) aceita uma
    // gramatura que a faixa default (30-500) rejeitaria.
    const resultado = calcularEditorial(
      pedidoEditorialValido(),
      contextoEditorialValido({ gramaturaMioloGm2: 20, gramaturaMinGm2: 10, gramaturaMaxGm2: 900 })
    );
    expect(resultado.custoBase.toNumber()).toBeGreaterThan(0);
  });

  it("dentro da faixa default não lança (comportamento normal preservado)", () => {
    const resultado = calcularEditorial(
      pedidoEditorialValido(),
      contextoEditorialValido({ gramaturaMioloGm2: 90, gramaturaCapaGm2: 250 })
    );
    expect(resultado.custoBase.toNumber()).toBeGreaterThan(0);
  });
});

describe("precificar() — EDITORIAL passa pelo mesmo comporPreco de todo mundo", () => {
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
    paginasPorCadernoPadrao: 16,
  };

  function contextoEditorial(extra?: Partial<ContextoPrecificacao>): ContextoPrecificacao {
    return {
      itemGraficaId: "livro-brochura",
      modeloCalculo: "EDITORIAL",
      viraFolha: false,
      parametros: PARAMS,
      editorial: contextoEditorialValido(),
      ...extra,
    };
  }

  it("preço final reflete overhead + margem + imposto sobre o custo base (miolo + capa + encadernação)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "EDITORIAL",
      pedido: pedidoEditorialValido({ quantidade: 100, numeroPaginas: 96 }),
      acabamentos: [],
    };

    const resultado = precificar(pedido, contextoEditorial());

    expect(resultado.custoDireto.toNumber()).toBeGreaterThan(0);
    expect(resultado.precoFinal.toNumber()).toBeGreaterThan(resultado.custoDireto.toNumber());
    expect(resultado.metricas.numeroCadernos).toBe(6);
    expect(resultado.metricas.paginasEfetivas).toBe(96);
    expect(typeof resultado.metricas.custoPapelMiolo).toBe("number");
    expect(typeof resultado.metricas.custoPapelCapa).toBe("number");
    expect(typeof resultado.metricas.custoEncadernacao).toBe("number");
  });

  it("achado C2: repassa gramaturaBaseMiolo/origemPrecoPapelMiolo/gramaturaBaseCapa/origemPrecoPapelCapa pras metricas (antes eram descartados)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "EDITORIAL",
      pedido: pedidoEditorialValido({ quantidade: 100, numeroPaginas: 96 }),
      acabamentos: [],
    };

    const resultado = precificar(
      pedido,
      contextoEditorial({
        editorial: contextoEditorialValido({
          gramaturaBaseMiolo: 75,
          origemPrecoPapelMiolo: "APROXIMADO",
          gramaturaBaseCapa: 250,
          origemPrecoPapelCapa: "EXATO",
        }),
      })
    );

    expect(resultado.metricas.gramaturaBaseMiolo).toBe(75);
    expect(resultado.metricas.origemPrecoPapelMiolo).toBe("APROXIMADO");
    expect(resultado.metricas.gramaturaBaseCapa).toBe(250);
    expect(resultado.metricas.origemPrecoPapelCapa).toBe("EXATO");
  });

  it("CONTEXTO_EDITORIAL_NAO_CONFIGURADO quando o contexto não tem editorial", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "EDITORIAL",
      pedido: pedidoEditorialValido(),
      acabamentos: [],
    };
    const contexto = contextoEditorial();
    delete contexto.editorial;

    try {
      precificar(pedido, contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("CONTEXTO_EDITORIAL_NAO_CONFIGURADO");
    }
  });

  it("achado C1: precificar() plumba GRAMATURA_INVALIDA na faixa default do tenant (mesmo caminho do OFFSET)", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "EDITORIAL",
      pedido: pedidoEditorialValido(),
      acabamentos: [],
    };
    const contexto = contextoEditorial({
      editorial: contextoEditorialValido({ gramaturaMioloGm2: 9 }),
    });

    try {
      precificar(pedido, contexto);
      expect.fail("deveria ter lançado ErroPrecificacao");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("GRAMATURA_INVALIDA");
    }
  });

  it("achado C1: precificar() respeita PARAMS.gramaturaMinGm2/MaxGm2 do tenant quando configurado", () => {
    const pedido: PedidoPrecificacao = {
      tipo: "EDITORIAL",
      pedido: pedidoEditorialValido(),
      acabamentos: [],
    };
    const contexto = contextoEditorial({
      parametros: { ...PARAMS, gramaturaMinGm2: 10, gramaturaMaxGm2: 900 },
      editorial: contextoEditorialValido({ gramaturaMioloGm2: 20 }),
    });

    const resultado = precificar(pedido, contexto);
    expect(resultado.custoDireto.toNumber()).toBeGreaterThan(0);
  });
});
