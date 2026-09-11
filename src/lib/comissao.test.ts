import { describe, it, expect } from "vitest";
import {
  calcularValorBase,
  calcularComissao,
  resolverRegraComissao,
  type RegraComissaoCandidata,
} from "./comissao";

describe("calcularValorBase", () => {
  it("modo VALOR usa o total do orçamento direto, ignora itens", () => {
    expect(calcularValorBase(1000, [{ precoTotal: 999, custoTotal: 1 }], "VALOR")).toBe(1000);
  });

  it("modo LUCRO soma preço - custo de cada item", () => {
    const itens = [
      { precoTotal: 500, custoTotal: 200 },
      { precoTotal: 300, custoTotal: 100 },
    ];
    expect(calcularValorBase(800, itens, "LUCRO")).toBe(500); // (500-200) + (300-100)
  });

  it("modo LUCRO com item sem custo cadastrado (custoTotal 0) conta como lucro total", () => {
    expect(calcularValorBase(200, [{ precoTotal: 200, custoTotal: 0 }], "LUCRO")).toBe(200);
  });
});

describe("calcularComissao", () => {
  it("calcula percentual simples sobre o valor-base", () => {
    expect(calcularComissao(1000, 0.05)).toBe(50);
  });

  it("nunca fica negativa mesmo com valor-base negativo (venda abaixo do custo)", () => {
    expect(calcularComissao(-100, 0.1)).toBe(0);
  });

  it("percentual zero não gera comissão", () => {
    expect(calcularComissao(1000, 0)).toBe(0);
  });
});

// Achado A12 da Parte 4 da auditoria de abrangência — resolução por
// especificidade de RegraComissao (Parte 1 da proposta). Fábrica de linha
// mínima válida, sobrescrita campo a campo em cada teste.
function regra(sobrepor: Partial<RegraComissaoCandidata> = {}): RegraComissaoCandidata {
  return {
    id: "r",
    prioridade: 0,
    usuarioId: null,
    itemCatalogoId: null,
    tipoItem: null,
    margemMinPercent: null,
    margemMaxPercent: null,
    percentual: 0.1,
    baseCalculo: null,
    ...sobrepor,
  };
}

describe("resolverRegraComissao", () => {
  it("nenhuma regra cadastrada: retorna null (fallback pro call site, Usuario.comissaoPercent)", () => {
    expect(resolverRegraComissao([], { usuarioId: "u1" })).toBeNull();
  });

  it("regra existe mas não bate (usuário diferente): retorna null", () => {
    const regras = [regra({ id: "r1", usuarioId: "u2" })];
    expect(resolverRegraComissao(regras, { usuarioId: "u1" })).toBeNull();
  });

  it("regra coringa (todo filtro null) bate com qualquer contexto", () => {
    const regras = [regra({ id: "coringa" })];
    const resolvida = resolverRegraComissao(regras, {
      usuarioId: "u1",
      itemCatalogoId: "i1",
      tipoItem: "Cartão",
      margemPercent: 0.5,
    });
    expect(resolvida?.id).toBe("coringa");
  });

  it("regra mais específica (usuário + item) vence a genérica (só usuário) quando as duas batem", () => {
    const generica = regra({ id: "generica", usuarioId: "u1", percentual: 0.05 });
    const especifica = regra({ id: "especifica", usuarioId: "u1", itemCatalogoId: "i1", percentual: 0.15 });
    const resolvida = resolverRegraComissao([generica, especifica], {
      usuarioId: "u1",
      itemCatalogoId: "i1",
    });
    expect(resolvida?.id).toBe("especifica");
    expect(resolvida?.percentual).toBe(0.15);
  });

  it("regra de item (usuarioId null) vence a coringa quando o item bate, mesmo pra vendedor sem cadastro", () => {
    const coringa = regra({ id: "coringa", percentual: 0.02 });
    const porItem = regra({ id: "por-item", itemCatalogoId: "i1", percentual: 0.2 });
    const resolvida = resolverRegraComissao([coringa, porItem], {
      usuarioId: null, // vendedor sem cadastro
      itemCatalogoId: "i1",
    });
    expect(resolvida?.id).toBe("por-item");
  });

  it("regra com usuarioId preenchido NUNCA bate pra vendedor sem cadastro (usuarioId null no contexto)", () => {
    const regras = [regra({ id: "r1", usuarioId: "u1", percentual: 0.3 })];
    expect(resolverRegraComissao(regras, { usuarioId: null })).toBeNull();
  });

  it("faixa de margem: só bate quando a margem do contexto está dentro do min/max", () => {
    const regraFaixa = regra({ id: "faixa-alta", margemMinPercent: 0.3, percentual: 0.12 });
    expect(resolverRegraComissao([regraFaixa], { usuarioId: "u1", margemPercent: 0.5 })?.id).toBe(
      "faixa-alta"
    );
    expect(resolverRegraComissao([regraFaixa], { usuarioId: "u1", margemPercent: 0.1 })).toBeNull();
  });

  it("faixa de margem: regra que filtra margem não bate quando a margem do contexto é indeterminada (undefined)", () => {
    const regraFaixa = regra({ id: "faixa", margemMinPercent: 0.1 });
    expect(resolverRegraComissao([regraFaixa], { usuarioId: "u1" })).toBeNull();
  });

  it("empate de especificidade: prioridade maior desempata", () => {
    const baixa = regra({ id: "baixa-prioridade", usuarioId: "u1", prioridade: 1, percentual: 0.05 });
    const alta = regra({ id: "alta-prioridade", usuarioId: "u1", prioridade: 5, percentual: 0.09 });
    const resolvida = resolverRegraComissao([baixa, alta], { usuarioId: "u1" });
    expect(resolvida?.id).toBe("alta-prioridade");
  });

  it("categoria (tipoItem) precisa bater exatamente — categoria diferente não bate", () => {
    const regras = [regra({ id: "r1", tipoItem: "Cartão", percentual: 0.07 })];
    expect(resolverRegraComissao(regras, { usuarioId: "u1", tipoItem: "Banner" })).toBeNull();
    expect(resolverRegraComissao(regras, { usuarioId: "u1", tipoItem: "Cartão" })?.id).toBe("r1");
  });
});
