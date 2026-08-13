import { describe, it, expect } from "vitest";
import {
  montarChavePerda,
  resolverPerdasConfirmadas,
  calcularEstoqueDepois,
  validarEstoqueSuficiente,
  chaveFisicaMaterial,
  type ItemParaBaixa,
  type ItemParaValidacaoEstoque,
} from "./perda-fixa-producao";

describe("montarChavePerda", () => {
  it("combina orcamentoItemId e fichaTecnicaItemId", () => {
    expect(montarChavePerda("item1", "ficha1")).toBe("item1::ficha1");
  });

  it("gera chaves diferentes pra produtos diferentes que usam o mesmo material", () => {
    const a = montarChavePerda("item1", "ficha1");
    const b = montarChavePerda("item2", "ficha1");
    expect(a).not.toBe(b);
  });
});

describe("resolverPerdasConfirmadas", () => {
  const itens: ItemParaBaixa[] = [
    { chave: "item1::ficha1", quantidadeConsumida: 10, perdaPadrao: 2 },
    { chave: "item2::ficha1", quantidadeConsumida: 5, perdaPadrao: 2 },
  ];

  it("bloqueia quando falta a confirmação de algum material", () => {
    const resultado = resolverPerdasConfirmadas(itens, [
      { chave: "item1::ficha1", perdaAplicada: 2 },
    ]);
    expect(resultado.ok).toBe(false);
  });

  it("respeita o valor editado (override explícito), não o padrão", () => {
    const resultado = resolverPerdasConfirmadas(itens, [
      { chave: "item1::ficha1", perdaAplicada: 7 },
      { chave: "item2::ficha1", perdaAplicada: 0 },
    ]);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.porChave.get("item1::ficha1")).toBe(7);
      expect(resultado.porChave.get("item2::ficha1")).toBe(0);
    }
  });

  it("aceita confirmação zerada pra uma linha repetida (mesmo material em 2 produtos)", () => {
    const resultado = resolverPerdasConfirmadas(itens, [
      { chave: "item1::ficha1", perdaAplicada: 2 },
      { chave: "item2::ficha1", perdaAplicada: 0 },
    ]);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.porChave.get("item2::ficha1")).toBe(0);
    }
  });

  it("não bloqueia quando não há itens a validar, mesmo com payload extra sobrando", () => {
    const resultado = resolverPerdasConfirmadas([], [{ chave: "sobrando", perdaAplicada: 1 }]);
    expect(resultado.ok).toBe(true);
  });
});

describe("calcularEstoqueDepois", () => {
  it("desconta consumo por ficha técnica e perda fixa juntos", () => {
    expect(calcularEstoqueDepois(100, 10, 2)).toBe(88);
  });

  it("material sem perda configurada só desconta o consumo (perdaAplicada = 0)", () => {
    expect(calcularEstoqueDepois(100, 10, 0)).toBe(90);
  });

  it("integra com cruzouLimiteMinimo usando o estoque final combinado", async () => {
    const { cruzouLimiteMinimo } = await import("./estoque-critico");
    const estoqueAntes = 20;
    const estoqueDepois = calcularEstoqueDepois(estoqueAntes, 5, 7);
    expect(estoqueDepois).toBe(8);
    // só o consumo (5) deixaria em 15, ainda acima do mínimo de 10 — não cruza.
    expect(cruzouLimiteMinimo(estoqueAntes, estoqueAntes - 5, 10)).toBe(false);
    // consumo + perda (12) deixa em 8, abaixo do mínimo — cruza.
    expect(cruzouLimiteMinimo(estoqueAntes, estoqueDepois, 10)).toBe(true);
  });
});

describe("chaveFisicaMaterial", () => {
  it("usa varianteId quando existe", () => {
    expect(chaveFisicaMaterial({ materiaPrimaId: "m1", varianteId: "v1" })).toBe("v1");
  });

  it("cai pra materiaPrimaId quando não há variante", () => {
    expect(chaveFisicaMaterial({ materiaPrimaId: "m1", varianteId: null })).toBe("m1");
  });
});

describe("validarEstoqueSuficiente", () => {
  // materiaPrimaId default = a própria chave, então por padrão cada item()
  // representa um material físico DIFERENTE (comportamento dos testes já
  // existentes abaixo) — passe o mesmo materiaPrimaId explicitamente pra
  // simular duas linhas apontando pro mesmo saldo físico.
  const item = (
    chave: string,
    estoqueAtual: number,
    quantidadeConsumida: number,
    materiaPrimaId: string = chave,
    varianteId: string | null = null
  ): ItemParaValidacaoEstoque => ({
    chave,
    quantidadeConsumida,
    perdaPadrao: 0,
    estoqueAtual,
    materiaPrimaNome: `Material ${chave}`,
    materiaPrimaId,
    varianteId,
  });

  it("passa quando consumo + perda não deixa nada negativo", () => {
    const resultado = validarEstoqueSuficiente(
      [item("a", 100, 10)],
      new Map([["a", 5]])
    );
    expect(resultado.ok).toBe(true);
  });

  it("bloqueia quando um valor de perda digitado errado estouraria o estoque", () => {
    const resultado = validarEstoqueSuficiente(
      [item("a", 100, 10)],
      new Map([["a", 5000]])
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensagem).toContain("Material a");
    }
  });

  it("bloqueia quando só o consumo da ficha técnica já é maior que o estoque", () => {
    const resultado = validarEstoqueSuficiente([item("a", 5, 10)], new Map([["a", 0]]));
    expect(resultado.ok).toBe(false);
  });

  it("lista todos os materiais insuficientes, não só o primeiro", () => {
    const resultado = validarEstoqueSuficiente(
      [item("a", 5, 10), item("b", 5, 10)],
      new Map([
        ["a", 0],
        ["b", 0],
      ])
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensagem).toContain("Material a");
      expect(resultado.mensagem).toContain("Material b");
    }
  });

  it("estoque exatamente zero não conta como insuficiente", () => {
    const resultado = validarEstoqueSuficiente([item("a", 10, 10)], new Map([["a", 0]]));
    expect(resultado.ok).toBe(true);
  });

  // Bug real relatado: dois produtos do MESMO orçamento consomem o MESMO
  // material (ex: dois produtos impressos no mesmo papel). itensParaBaixa é
  // achatado por item×ficha técnica, então cada linha carrega o
  // estoqueAtual CHEIO do material — sem agregar por identidade física
  // (varianteId ?? materiaPrimaId) antes de comparar, cada linha passa
  // isoladamente mas a baixa de verdade desconta as duas cumulativamente,
  // deixando o estoque negativo sem a validação nunca ter percebido.
  it("bloqueia quando dois itens do mesmo orçamento consomem o MESMO material físico e cada um cabe sozinho mas juntos não", () => {
    const resultado = validarEstoqueSuficiente(
      [
        item("item1::fichaA", 100, 60, "papel-A4"),
        item("item2::fichaB", 100, 60, "papel-A4"),
      ],
      new Map()
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensagem).toContain("Material item1::fichaA");
      // Não deve listar o material duas vezes, mesmo com duas linhas.
      expect(resultado.mensagem.split("Material item1::fichaA").length - 1).toBe(1);
    }
  });

  it("soma consumo E perda aplicada de todas as linhas do mesmo material físico antes de validar", () => {
    const resultado = validarEstoqueSuficiente(
      [item("item1::fichaA", 100, 40, "papel-A4"), item("item2::fichaB", 100, 40, "papel-A4")],
      new Map([
        ["item1::fichaA", 10],
        ["item2::fichaB", 10],
      ])
    );
    // 40+10 + 40+10 = 100, exatamente o estoque — não deveria faltar.
    expect(resultado.ok).toBe(true);
  });

  it("não agrega materiais DIFERENTES (materiaPrimaId distinto) mesmo com consumos parecidos", () => {
    const resultado = validarEstoqueSuficiente(
      [item("item1::fichaA", 100, 60), item("item2::fichaB", 100, 60)],
      new Map()
    );
    // materiaPrimaId default = a própria chave => materiais diferentes,
    // cada um cabe isoladamente (60 <= 100).
    expect(resultado.ok).toBe(true);
  });

  it("não agrega uma variante com a matéria-prima genérica sem variante, mesmo com o mesmo materiaPrimaId", () => {
    const semVariante = item("item1::fichaA", 100, 60, "papel", null);
    const comVariante = item("item2::fichaB", 100, 60, "papel", "variante-300g");
    const resultado = validarEstoqueSuficiente([semVariante, comVariante], new Map());
    // São saldos físicos diferentes — não deveriam ser somados.
    expect(resultado.ok).toBe(true);
  });
});
