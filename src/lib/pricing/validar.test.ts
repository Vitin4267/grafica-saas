import { describe, expect, it } from "vitest";
import {
  validarPedidoDigital,
  validarPedidoFlexografia,
  validarPedidoM2,
  validarPedidoOffset,
  validarPedidoSetupPorPeca,
  validarSomaEncargos,
} from "./validar";
import { ErroPrecificacao } from "./erros";
import type {
  ContextoDigital,
  ContextoFlexografia,
  ContextoM2,
  ContextoOffset,
  PedidoDigital,
  PedidoFlexografia,
  PedidoM2,
  PedidoOffset,
  PedidoSetupPorPeca,
} from "./tipos";

// Fixtures base "tudo válido" — mesma forma de montar os objetos usada em
// __tests__/golden.test.ts (bobinas/folhas com id+larguraNominal/refile ou
// larguraFolha/alturaFolha, custoM2Material/precoPorKg, etc). Cada teste parte
// de uma cópia dessas fixtures e altera só o campo sob teste, pra garantir que
// o código sob teste seja SEMPRE o primeiro check a disparar (os campos são
// validados em ordem dentro de validar.ts).

function pedidoM2Valido(overrides: Partial<PedidoM2> = {}): PedidoM2 {
  return {
    larguraM: 0.8,
    alturaM: 1.2,
    quantidade: 1,
    ...overrides,
  };
}

function contextoM2Valido(overrides: Partial<ContextoM2> = {}): ContextoM2 {
  return {
    bobinas: [{ id: "bobina-1.00", larguraNominal: 1.0, refile: 0.02 }],
    custoM2Material: 18.5,
    custoImpressaoM2: 6,
    areaMinimaFaturavel: 0.25,
    ...overrides,
  };
}

function pedidoOffsetValido(overrides: Partial<PedidoOffset> = {}): PedidoOffset {
  return {
    larguraM: 0.09,
    alturaM: 0.05,
    quantidade: 1000,
    corFrente: 4,
    corVerso: 4,
    ...overrides,
  };
}

function contextoOffsetValido(overrides: Partial<ContextoOffset> = {}): ContextoOffset {
  return {
    folhas: [{ id: "folha-66x96", nome: "Fechada 66x96", larguraFolha: 0.66, alturaFolha: 0.96 }],
    gramaturaGm2: 300,
    precoPorKg: 8.5,
    viraFolha: false,
    ...overrides,
  };
}

function pedidoFlexografiaValido(overrides: Partial<PedidoFlexografia> = {}): PedidoFlexografia {
  return {
    larguraM: 0.08,
    alturaM: 0.05,
    quantidade: 100,
    numeroCores: 3,
    ...overrides,
  };
}

function contextoFlexografiaValido(
  overrides: Partial<ContextoFlexografia> = {}
): ContextoFlexografia {
  return {
    bobinas: [{ id: "bobina-0.30", larguraNominal: 0.3, refile: 0.01 }],
    custoM2Material: 5,
    ...overrides,
  };
}

function pedidoDigitalValido(overrides: Partial<PedidoDigital> = {}): PedidoDigital {
  return {
    quantidade: 100,
    ...overrides,
  };
}

function contextoDigitalValido(overrides: Partial<ContextoDigital> = {}): ContextoDigital {
  return {
    custoSubstratoPorPeca: 0.5,
    ...overrides,
  };
}

function pedidoSetupPorPecaValido(overrides: Partial<PedidoSetupPorPeca> = {}): PedidoSetupPorPeca {
  return {
    quantidade: 100,
    numeroSetups: 1,
    ...overrides,
  };
}

function codigoDoErro(fn: () => void): string {
  try {
    fn();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroPrecificacao);
    return (erro as ErroPrecificacao).codigo;
  }
  throw new Error("esperava que a função lançasse ErroPrecificacao, mas não lançou");
}

describe("validarPedidoM2 — casos válidos (sanity check, não deve lançar)", () => {
  it("não lança para pedido/contexto totalmente válidos", () => {
    expect(() => validarPedidoM2(pedidoM2Valido(), contextoM2Valido())).not.toThrow();
  });
});

describe("validarPedidoM2 — QUANTIDADE_INVALIDA", () => {
  it("dispara com quantidade zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido({ quantidade: 0 }), contextoM2Valido())
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });

  it("dispara com quantidade negativa", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido({ quantidade: -1 }), contextoM2Valido())
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });

  it("dispara com quantidade fracionária", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido({ quantidade: 1.5 }), contextoM2Valido())
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });

  it("fronteira válida: quantidade = 1 (menor inteiro positivo) não lança", () => {
    expect(() =>
      validarPedidoM2(pedidoM2Valido({ quantidade: 1 }), contextoM2Valido())
    ).not.toThrow();
  });
});

describe("validarPedidoM2 — DIMENSAO_INVALIDA (largura/altura)", () => {
  it("dispara com larguraM zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido({ larguraM: 0 }), contextoM2Valido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara com larguraM negativa", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido({ larguraM: -0.5 }), contextoM2Valido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara com alturaM zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido({ alturaM: 0 }), contextoM2Valido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara com alturaM negativa", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido({ alturaM: -1 }), contextoM2Valido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("fronteira válida: larguraM e alturaM ligeiramente acima de zero não lançam", () => {
    expect(() =>
      validarPedidoM2(
        pedidoM2Valido({ larguraM: 0.0001, alturaM: 0.0001 }),
        contextoM2Valido()
      )
    ).not.toThrow();
  });
});

describe("validarPedidoM2 — MATERIAL_SEM_BOBINA", () => {
  it("dispara quando a lista de bobinas está vazia", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido(), contextoM2Valido({ bobinas: [] }))
    );
    expect(erro).toBe("MATERIAL_SEM_BOBINA");
  });

  it("não lança quando há pelo menos uma bobina cadastrada", () => {
    expect(() =>
      validarPedidoM2(
        pedidoM2Valido(),
        contextoM2Valido({ bobinas: [{ id: "b1", larguraNominal: 1, refile: 0.02 }] })
      )
    ).not.toThrow();
  });
});

describe("validarPedidoM2 — CUSTO_INVALIDO (custoM2Material)", () => {
  it("dispara com custoM2Material zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido(), contextoM2Valido({ custoM2Material: 0 }))
    );
    expect(erro).toBe("CUSTO_INVALIDO");
  });

  it("dispara com custoM2Material negativo", () => {
    const erro = codigoDoErro(() =>
      validarPedidoM2(pedidoM2Valido(), contextoM2Valido({ custoM2Material: -10 }))
    );
    expect(erro).toBe("CUSTO_INVALIDO");
  });

  it("fronteira válida: custoM2Material ligeiramente acima de zero não lança", () => {
    expect(() =>
      validarPedidoM2(pedidoM2Valido(), contextoM2Valido({ custoM2Material: 0.01 }))
    ).not.toThrow();
  });
});

describe("validarPedidoOffset — casos válidos (sanity check, não deve lançar)", () => {
  it("não lança para pedido/contexto totalmente válidos", () => {
    expect(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido())
    ).not.toThrow();
  });
});

describe("validarPedidoOffset — QUANTIDADE_INVALIDA e DIMENSAO_INVALIDA (largura/altura, herdados de validarComum)", () => {
  it("dispara QUANTIDADE_INVALIDA com quantidade zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ quantidade: 0 }), contextoOffsetValido())
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });

  it("dispara QUANTIDADE_INVALIDA com quantidade negativa", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ quantidade: -5 }), contextoOffsetValido())
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });

  it("dispara QUANTIDADE_INVALIDA com quantidade fracionária", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ quantidade: 100.5 }), contextoOffsetValido())
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });

  it("fronteira válida: quantidade = 1 não lança", () => {
    expect(() =>
      validarPedidoOffset(pedidoOffsetValido({ quantidade: 1 }), contextoOffsetValido())
    ).not.toThrow();
  });

  it("dispara DIMENSAO_INVALIDA com larguraM zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ larguraM: 0 }), contextoOffsetValido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara DIMENSAO_INVALIDA com alturaM negativa", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ alturaM: -0.01 }), contextoOffsetValido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("fronteira válida: larguraM e alturaM ligeiramente acima de zero não lançam", () => {
    expect(() =>
      validarPedidoOffset(
        pedidoOffsetValido({ larguraM: 0.0001, alturaM: 0.0001 }),
        contextoOffsetValido()
      )
    ).not.toThrow();
  });
});

describe("validarPedidoOffset — DIMENSAO_INVALIDA (corFrente)", () => {
  it("dispara com corFrente zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ corFrente: 0 }), contextoOffsetValido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara com corFrente negativo", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ corFrente: -1 }), contextoOffsetValido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara com corFrente fracionário", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ corFrente: 1.5 }), contextoOffsetValido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("fronteira válida: corFrente = 1 (mínimo permitido) não lança", () => {
    expect(() =>
      validarPedidoOffset(pedidoOffsetValido({ corFrente: 1 }), contextoOffsetValido())
    ).not.toThrow();
  });
});

describe("validarPedidoOffset — DIMENSAO_INVALIDA (corVerso)", () => {
  it("dispara com corVerso negativo", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ corVerso: -1 }), contextoOffsetValido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara com corVerso fracionário", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido({ corVerso: 0.5 }), contextoOffsetValido())
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("fronteira válida: corVerso = 0 (mínimo permitido, frente e verso sem cor no verso) não lança", () => {
    expect(() =>
      validarPedidoOffset(pedidoOffsetValido({ corVerso: 0 }), contextoOffsetValido())
    ).not.toThrow();
  });
});

describe("validarPedidoOffset — MATERIAL_SEM_FOLHA", () => {
  it("dispara quando a lista de folhas está vazia", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ folhas: [] }))
    );
    expect(erro).toBe("MATERIAL_SEM_FOLHA");
  });

  it("não lança quando há pelo menos um formato de folha cadastrado", () => {
    expect(() =>
      validarPedidoOffset(
        pedidoOffsetValido(),
        contextoOffsetValido({
          folhas: [{ id: "f1", nome: "Folha", larguraFolha: 0.66, alturaFolha: 0.96 }],
        })
      )
    ).not.toThrow();
  });
});

describe("validarPedidoOffset — CUSTO_INVALIDO (precoPorKg)", () => {
  it("dispara com precoPorKg zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ precoPorKg: 0 }))
    );
    expect(erro).toBe("CUSTO_INVALIDO");
  });

  it("dispara com precoPorKg negativo", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ precoPorKg: -8.5 }))
    );
    expect(erro).toBe("CUSTO_INVALIDO");
  });

  it("fronteira válida: precoPorKg ligeiramente acima de zero não lança", () => {
    expect(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ precoPorKg: 0.01 }))
    ).not.toThrow();
  });
});

describe("validarPedidoOffset — GRAMATURA_INVALIDA (faixa válida: 30 a 500 g/m², inclusive)", () => {
  it("dispara com gramatura abaixo de 30 (29,99)", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ gramaturaGm2: 29.99 }))
    );
    expect(erro).toBe("GRAMATURA_INVALIDA");
  });

  it("fronteira válida: gramatura = 30 (limite inferior inclusivo) não lança", () => {
    expect(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ gramaturaGm2: 30 }))
    ).not.toThrow();
  });

  it("fronteira válida: gramatura = 500 (limite superior inclusivo) não lança", () => {
    expect(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ gramaturaGm2: 500 }))
    ).not.toThrow();
  });

  it("dispara com gramatura acima de 500 (500,01)", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ gramaturaGm2: 500.01 }))
    );
    expect(erro).toBe("GRAMATURA_INVALIDA");
  });
});

// Achado N13 da auditoria de abrangência — faixa configurável por gráfica
// (ParametrosGrafica.gramaturaMinGm2/gramaturaMaxGm2, plumada via
// ContextoOffset.gramaturaMinGm2/gramaturaMaxGm2). Cobre tanto o caso de uma
// gráfica de embalagem/cartonagem (duplex/triplex, até 600 g/m²) quanto uma
// editorial (papel bíblia, a partir de 22 g/m²).
describe("validarPedidoOffset — GRAMATURA_INVALIDA com faixa configurável (ParametrosGrafica.gramaturaMinGm2/gramaturaMaxGm2)", () => {
  it("aceita gramatura de cartão duplex (550) quando a faixa é ampliada pra 30–600", () => {
    expect(() =>
      validarPedidoOffset(
        pedidoOffsetValido(),
        contextoOffsetValido({ gramaturaGm2: 550, gramaturaMinGm2: 30, gramaturaMaxGm2: 600 })
      )
    ).not.toThrow();
  });

  it("dispara com gramatura de cartão duplex (550) quando a faixa NÃO é ampliada (default 30–500)", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ gramaturaGm2: 550 }))
    );
    expect(erro).toBe("GRAMATURA_INVALIDA");
  });

  it("aceita papel bíblia (22) quando a faixa é reduzida pra 20–500", () => {
    expect(() =>
      validarPedidoOffset(
        pedidoOffsetValido(),
        contextoOffsetValido({ gramaturaGm2: 22, gramaturaMinGm2: 20, gramaturaMaxGm2: 500 })
      )
    ).not.toThrow();
  });

  it("dispara com papel bíblia (22) quando a faixa NÃO é reduzida (default mínimo 30)", () => {
    const erro = codigoDoErro(() =>
      validarPedidoOffset(pedidoOffsetValido(), contextoOffsetValido({ gramaturaGm2: 22 }))
    );
    expect(erro).toBe("GRAMATURA_INVALIDA");
  });

  it("fronteiras da faixa configurada são inclusivas (não lança em 20 nem em 600)", () => {
    expect(() =>
      validarPedidoOffset(
        pedidoOffsetValido(),
        contextoOffsetValido({ gramaturaGm2: 20, gramaturaMinGm2: 20, gramaturaMaxGm2: 600 })
      )
    ).not.toThrow();
    expect(() =>
      validarPedidoOffset(
        pedidoOffsetValido(),
        contextoOffsetValido({ gramaturaGm2: 600, gramaturaMinGm2: 20, gramaturaMaxGm2: 600 })
      )
    ).not.toThrow();
  });

  it("dispara logo fora das fronteiras da faixa configurada (19,99 e 600,01)", () => {
    const erroAbaixo = codigoDoErro(() =>
      validarPedidoOffset(
        pedidoOffsetValido(),
        contextoOffsetValido({ gramaturaGm2: 19.99, gramaturaMinGm2: 20, gramaturaMaxGm2: 600 })
      )
    );
    expect(erroAbaixo).toBe("GRAMATURA_INVALIDA");
    const erroAcima = codigoDoErro(() =>
      validarPedidoOffset(
        pedidoOffsetValido(),
        contextoOffsetValido({ gramaturaGm2: 600.01, gramaturaMinGm2: 20, gramaturaMaxGm2: 600 })
      )
    );
    expect(erroAcima).toBe("GRAMATURA_INVALIDA");
  });
});

describe("validarSomaEncargos — ENCARGOS_INVALIDOS (limiar: soma >= 0,85 dispara)", () => {
  it("fronteira válida: soma logo abaixo de 85% (0,849999) não lança", () => {
    expect(() => validarSomaEncargos(0.849999)).not.toThrow();
  });

  it("dispara exatamente em 85% (limiar é >=, então 0,85 já dispara)", () => {
    const erro = codigoDoErro(() => validarSomaEncargos(0.85));
    expect(erro).toBe("ENCARGOS_INVALIDOS");
  });

  it("dispara com soma acima de 85% (0,86)", () => {
    const erro = codigoDoErro(() => validarSomaEncargos(0.86));
    expect(erro).toBe("ENCARGOS_INVALIDOS");
  });

  it("não lança com soma baixa e plausível (ex.: 0,26 = margem 20% + imposto 6%)", () => {
    expect(() => validarSomaEncargos(0.26)).not.toThrow();
  });
});

describe("validarPedidoFlexografia — casos válidos (sanity check, não deve lançar)", () => {
  it("não lança para pedido/contexto totalmente válidos", () => {
    expect(() =>
      validarPedidoFlexografia(pedidoFlexografiaValido(), contextoFlexografiaValido())
    ).not.toThrow();
  });
});

describe("validarPedidoFlexografia — QUANTIDADE_INVALIDA e DIMENSAO_INVALIDA (largura/altura, herdados de validarComum)", () => {
  it("dispara QUANTIDADE_INVALIDA com quantidade zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido({ quantidade: 0 }),
        contextoFlexografiaValido()
      )
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });

  it("dispara QUANTIDADE_INVALIDA com quantidade fracionária", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido({ quantidade: 10.5 }),
        contextoFlexografiaValido()
      )
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });

  it("dispara DIMENSAO_INVALIDA com larguraM zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido({ larguraM: 0 }),
        contextoFlexografiaValido()
      )
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara DIMENSAO_INVALIDA com alturaM negativa", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido({ alturaM: -0.01 }),
        contextoFlexografiaValido()
      )
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });
});

describe("validarPedidoFlexografia — DIMENSAO_INVALIDA (numeroCores)", () => {
  it("dispara com numeroCores zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido({ numeroCores: 0 }),
        contextoFlexografiaValido()
      )
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara com numeroCores negativo", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido({ numeroCores: -1 }),
        contextoFlexografiaValido()
      )
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("dispara com numeroCores fracionário", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido({ numeroCores: 1.5 }),
        contextoFlexografiaValido()
      )
    );
    expect(erro).toBe("DIMENSAO_INVALIDA");
  });

  it("fronteira válida: numeroCores = 1 (mínimo permitido) não lança", () => {
    expect(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido({ numeroCores: 1 }),
        contextoFlexografiaValido()
      )
    ).not.toThrow();
  });
});

describe("validarPedidoFlexografia — MATERIAL_SEM_BOBINA", () => {
  it("dispara quando a lista de bobinas está vazia", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido(),
        contextoFlexografiaValido({ bobinas: [] })
      )
    );
    expect(erro).toBe("MATERIAL_SEM_BOBINA");
  });

  it("não lança quando há pelo menos uma bobina cadastrada", () => {
    expect(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido(),
        contextoFlexografiaValido({ bobinas: [{ id: "b1", larguraNominal: 0.3, refile: 0.01 }] })
      )
    ).not.toThrow();
  });
});

describe("validarPedidoFlexografia — CUSTO_INVALIDO (custoM2Material)", () => {
  it("dispara com custoM2Material zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido(),
        contextoFlexografiaValido({ custoM2Material: 0 })
      )
    );
    expect(erro).toBe("CUSTO_INVALIDO");
  });

  it("dispara com custoM2Material negativo", () => {
    const erro = codigoDoErro(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido(),
        contextoFlexografiaValido({ custoM2Material: -5 })
      )
    );
    expect(erro).toBe("CUSTO_INVALIDO");
  });

  it("fronteira válida: custoM2Material ligeiramente acima de zero não lança", () => {
    expect(() =>
      validarPedidoFlexografia(
        pedidoFlexografiaValido(),
        contextoFlexografiaValido({ custoM2Material: 0.01 })
      )
    ).not.toThrow();
  });
});

describe("validarPedidoDigital — casos válidos (sanity check, não deve lançar)", () => {
  it("não lança para pedido/contexto totalmente válidos, com ou sem numeroCliques", () => {
    expect(() =>
      validarPedidoDigital(pedidoDigitalValido(), contextoDigitalValido())
    ).not.toThrow();
    expect(() =>
      validarPedidoDigital(pedidoDigitalValido({ numeroCliques: 3 }), contextoDigitalValido())
    ).not.toThrow();
  });
});

describe("validarPedidoDigital — QUANTIDADE_INVALIDA (herdado de validarQuantidade)", () => {
  it("dispara com quantidade zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoDigital(pedidoDigitalValido({ quantidade: 0 }), contextoDigitalValido())
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });

  it("dispara com quantidade fracionária", () => {
    const erro = codigoDoErro(() =>
      validarPedidoDigital(pedidoDigitalValido({ quantidade: 2.5 }), contextoDigitalValido())
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });
});

describe("validarPedidoDigital — NUMERO_CLIQUES_INVALIDO (só quando informado)", () => {
  it("dispara com numeroCliques zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoDigital(pedidoDigitalValido({ numeroCliques: 0 }), contextoDigitalValido())
    );
    expect(erro).toBe("NUMERO_CLIQUES_INVALIDO");
  });

  it("dispara com numeroCliques fracionário", () => {
    const erro = codigoDoErro(() =>
      validarPedidoDigital(pedidoDigitalValido({ numeroCliques: 1.5 }), contextoDigitalValido())
    );
    expect(erro).toBe("NUMERO_CLIQUES_INVALIDO");
  });

  it("numeroCliques ausente (undefined) não lança — motor aplica default", () => {
    expect(() =>
      validarPedidoDigital(pedidoDigitalValido({ numeroCliques: undefined }), contextoDigitalValido())
    ).not.toThrow();
  });
});

describe("validarPedidoDigital — CUSTO_INVALIDO (custoSubstratoPorPeca)", () => {
  it("dispara com custoSubstratoPorPeca zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoDigital(pedidoDigitalValido(), contextoDigitalValido({ custoSubstratoPorPeca: 0 }))
    );
    expect(erro).toBe("CUSTO_INVALIDO");
  });

  it("dispara com custoSubstratoPorPeca negativo", () => {
    const erro = codigoDoErro(() =>
      validarPedidoDigital(
        pedidoDigitalValido(),
        contextoDigitalValido({ custoSubstratoPorPeca: -1 })
      )
    );
    expect(erro).toBe("CUSTO_INVALIDO");
  });
});

describe("validarPedidoSetupPorPeca — casos válidos (sanity check, não deve lançar)", () => {
  it("não lança para pedido totalmente válido", () => {
    expect(() => validarPedidoSetupPorPeca(pedidoSetupPorPecaValido())).not.toThrow();
  });
});

describe("validarPedidoSetupPorPeca — QUANTIDADE_INVALIDA (herdado de validarQuantidade)", () => {
  it("dispara com quantidade zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoSetupPorPeca(pedidoSetupPorPecaValido({ quantidade: 0 }))
    );
    expect(erro).toBe("QUANTIDADE_INVALIDA");
  });
});

describe("validarPedidoSetupPorPeca — NUMERO_SETUPS_INVALIDO (obrigatório, sem default)", () => {
  it("dispara com numeroSetups zero", () => {
    const erro = codigoDoErro(() =>
      validarPedidoSetupPorPeca(pedidoSetupPorPecaValido({ numeroSetups: 0 }))
    );
    expect(erro).toBe("NUMERO_SETUPS_INVALIDO");
  });

  it("dispara com numeroSetups negativo", () => {
    const erro = codigoDoErro(() =>
      validarPedidoSetupPorPeca(pedidoSetupPorPecaValido({ numeroSetups: -1 }))
    );
    expect(erro).toBe("NUMERO_SETUPS_INVALIDO");
  });

  it("dispara com numeroSetups fracionário", () => {
    const erro = codigoDoErro(() =>
      validarPedidoSetupPorPeca(pedidoSetupPorPecaValido({ numeroSetups: 1.5 }))
    );
    expect(erro).toBe("NUMERO_SETUPS_INVALIDO");
  });

  it("fronteira válida: numeroSetups = 1 (mínimo permitido) não lança", () => {
    expect(() =>
      validarPedidoSetupPorPeca(pedidoSetupPorPecaValido({ numeroSetups: 1 }))
    ).not.toThrow();
  });
});
