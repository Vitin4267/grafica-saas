import { describe, it, expect } from "vitest";
import { paraDecimal } from "@/lib/pricing/decimal";
import {
  ehCandidatoGangRun,
  calcularFracaoFolha,
  chaveGrupoGangRun,
  agruparPorChave,
  ratearCustoSetup,
  lerDadosOffsetDoBreakdown,
} from "./gang-run";

describe("ehCandidatoGangRun", () => {
  it("é candidato quando a quantidade não enche uma folha sozinha", () => {
    expect(ehCandidatoGangRun(250, 1000)).toBe(true);
  });

  it("não é candidato quando a quantidade enche exatamente a folha", () => {
    expect(ehCandidatoGangRun(1000, 1000)).toBe(false);
  });

  it("não é candidato quando a quantidade passa de uma folha", () => {
    expect(ehCandidatoGangRun(2500, 1000)).toBe(false);
  });

  it("rejeita entradas inválidas sem lançar", () => {
    expect(ehCandidatoGangRun(0, 1000)).toBe(false);
    expect(ehCandidatoGangRun(-5, 1000)).toBe(false);
    expect(ehCandidatoGangRun(100, 0)).toBe(false);
    expect(ehCandidatoGangRun(NaN, 1000)).toBe(false);
  });
});

describe("calcularFracaoFolha", () => {
  it("calcula a fração da folha ocupada", () => {
    expect(calcularFracaoFolha(250, 1000).toNumber()).toBeCloseTo(0.25);
    expect(calcularFracaoFolha(1000, 1000).toNumber()).toBe(1);
  });
});

describe("chaveGrupoGangRun", () => {
  const base = {
    papelId: "papel1",
    gramaturaGm2: 300,
    prensaId: "prensa1",
    folhaId: "folha1",
    corFrente: 4,
    corVerso: 0,
  };

  it("gera a mesma chave para itens fisicamente compatíveis", () => {
    expect(chaveGrupoGangRun(base)).toBe(chaveGrupoGangRun({ ...base }));
  });

  it("gera chaves diferentes quando papel muda", () => {
    expect(chaveGrupoGangRun(base)).not.toBe(chaveGrupoGangRun({ ...base, papelId: "papel2" }));
  });

  it("gera chaves diferentes quando as cores mudam (torres de tinta diferentes)", () => {
    expect(chaveGrupoGangRun(base)).not.toBe(chaveGrupoGangRun({ ...base, corFrente: 1 }));
  });

  it("gera chaves diferentes quando o formato de folha escolhido muda", () => {
    expect(chaveGrupoGangRun(base)).not.toBe(chaveGrupoGangRun({ ...base, folhaId: "folha2" }));
  });
});

describe("agruparPorChave", () => {
  it("agrupa itens pela chave calculada", () => {
    const itens = [
      { id: "a", grupo: "x" },
      { id: "b", grupo: "y" },
      { id: "c", grupo: "x" },
    ];
    const grupos = agruparPorChave(itens, (i) => i.grupo);
    expect(grupos.size).toBe(2);
    expect(grupos.get("x")?.map((i) => i.id)).toEqual(["a", "c"]);
    expect(grupos.get("y")?.map((i) => i.id)).toEqual(["b"]);
  });

  it("retorna mapa vazio pra lista vazia", () => {
    expect(agruparPorChave([], () => "x").size).toBe(0);
  });
});

describe("ratearCustoSetup", () => {
  it("divide proporcionalmente à fração de folha de cada item", () => {
    const itens = [
      { id: "a", fracaoFolha: 0.5 },
      { id: "b", fracaoFolha: 0.3 },
      { id: "c", fracaoFolha: 0.2 },
    ];
    const resultado = ratearCustoSetup(itens, paraDecimal(100));
    expect(resultado.get("a")!.toNumber()).toBeCloseTo(50);
    expect(resultado.get("b")!.toNumber()).toBeCloseTo(30);
    expect(resultado.get("c")!.toNumber()).toBeCloseTo(20);
  });

  it("a soma das fatias bate exatamente com o total, mesmo com arredondamento", () => {
    // 3 itens com frações que não dividem 100 exatamente (1/3 cada) —
    // sem a correção do último item, sobrariam/faltariam centavos.
    const itens = [
      { id: "a", fracaoFolha: 1 },
      { id: "b", fracaoFolha: 1 },
      { id: "c", fracaoFolha: 1 },
    ];
    const total = paraDecimal(100);
    const resultado = ratearCustoSetup(itens, total);
    const soma = [...resultado.values()].reduce((s, v) => s.plus(v), paraDecimal(0));
    expect(soma.toNumber()).toBeCloseTo(100, 10);
    // Cada fatia arredondada pra 2 casas — nenhuma negativa, nenhuma NaN.
    for (const valor of resultado.values()) {
      expect(valor.gte(0)).toBe(true);
    }
  });

  it("item sozinho no grupo recebe o custo total inteiro", () => {
    const resultado = ratearCustoSetup([{ id: "a", fracaoFolha: 0.4 }], paraDecimal(75));
    expect(resultado.get("a")!.toNumber()).toBe(75);
  });

  it("ignora itens com fração zero ou negativa no rateio", () => {
    const itens = [
      { id: "a", fracaoFolha: 1 },
      { id: "b", fracaoFolha: 0 },
    ];
    const resultado = ratearCustoSetup(itens, paraDecimal(50));
    expect(resultado.get("a")!.toNumber()).toBe(50);
    expect(resultado.get("b")!.toNumber()).toBe(0);
  });

  it("devolve zero pra todo mundo quando o custo total é zero", () => {
    const itens = [
      { id: "a", fracaoFolha: 0.5 },
      { id: "b", fracaoFolha: 0.5 },
    ];
    const resultado = ratearCustoSetup(itens, paraDecimal(0));
    expect(resultado.get("a")!.toNumber()).toBe(0);
    expect(resultado.get("b")!.toNumber()).toBe(0);
  });

  it("lida com lista vazia sem lançar", () => {
    const resultado = ratearCustoSetup([], paraDecimal(100));
    expect(resultado.size).toBe(0);
  });
});

describe("lerDadosOffsetDoBreakdown", () => {
  const breakdownValido = {
    detalhes: { chapas: "40.00", setup: "15.00", material: "100.00" },
    metricas: { nUp: 8, folhaEscolhida: { id: "folha1", nome: "Fechada 66x96" } },
  };

  it("extrai nUp, folha e custos de chapa/setup de um breakdown válido", () => {
    const dados = lerDadosOffsetDoBreakdown(breakdownValido);
    expect(dados).not.toBeNull();
    expect(dados!.nUp).toBe(8);
    expect(dados!.folhaId).toBe("folha1");
    expect(dados!.folhaNome).toBe("Fechada 66x96");
    expect(dados!.custoChapas.toNumber()).toBe(40);
    expect(dados!.custoSetup.toNumber()).toBe(15);
  });

  it("retorna null pra breakdown nulo ou não-objeto", () => {
    expect(lerDadosOffsetDoBreakdown(null)).toBeNull();
    expect(lerDadosOffsetDoBreakdown(undefined)).toBeNull();
    expect(lerDadosOffsetDoBreakdown("string")).toBeNull();
    expect(lerDadosOffsetDoBreakdown([1, 2, 3])).toBeNull();
  });

  it("retorna null quando falta metricas.nUp", () => {
    const semNUp = { detalhes: breakdownValido.detalhes, metricas: { folhaEscolhida: { id: "x" } } };
    expect(lerDadosOffsetDoBreakdown(semNUp)).toBeNull();
  });

  it("retorna null quando falta detalhes.chapas/setup (breakdown de outro modelo)", () => {
    const semChapas = {
      detalhes: { material: "100.00" },
      metricas: { nUp: 8, folhaEscolhida: { id: "x", nome: "y" } },
    };
    expect(lerDadosOffsetDoBreakdown(semChapas)).toBeNull();
  });

  it("retorna null quando nUp é zero ou negativo", () => {
    const nUpInvalido = {
      detalhes: breakdownValido.detalhes,
      metricas: { nUp: 0, folhaEscolhida: { id: "x", nome: "y" } },
    };
    expect(lerDadosOffsetDoBreakdown(nUpInvalido)).toBeNull();
  });
});
