import { describe, expect, it } from "vitest";
import { calcularCustoAcabamento } from "../acabamento";
import { ErroPrecificacao } from "../erros";
import type { ConfigAcabamento, ContextoAcabamento } from "../tipos";

describe("calcularCustoAcabamento", () => {
  it("FOLHA_IMPRESSA cobra pela folha de máquina (pré-refile), não pela peça final", () => {
    const config: ConfigAcabamento = {
      itemGraficaId: "bopp",
      nome: "BOPP Fosco",
      baseCobranca: "FOLHA_IMPRESSA",
      estagio: "PRE_REFILE",
      custoUnitario: 1,
      custoSetup: 0,
      custoMinimo: 0,
    };
    // 24 cartões por folha, mas o acabamento é cobrado pelas 10 folhas, não pelos 240 cartões
    const ctx: ContextoAcabamento = {
      quantidade: 240,
      larguraEfetivaM: 0.1,
      alturaEfetivaM: 0.1,
      folhasBoas: 9,
      folhasPerda: 1,
    };
    const custo = calcularCustoAcabamento(config, ctx);
    expect(custo.toNumber()).toBe(10); // 10 folhas × R$1, não 240 × R$1
  });

  it("lança erro quando a base exige dado que não foi fornecido (item não passou pelo motor offset)", () => {
    const config: ConfigAcabamento = {
      itemGraficaId: "bopp",
      nome: "BOPP Fosco",
      baseCobranca: "FOLHA_IMPRESSA",
      estagio: "PRE_REFILE",
      custoUnitario: 1,
      custoSetup: 0,
      custoMinimo: 0,
    };
    const ctx: ContextoAcabamento = { quantidade: 10, larguraEfetivaM: 0.1, alturaEfetivaM: 0.1 };
    expect(() => calcularCustoAcabamento(config, ctx)).toThrow(ErroPrecificacao);
  });

  it("respeita o piso de custoMinimo quando o cálculo variável é menor", () => {
    const config: ConfigAcabamento = {
      itemGraficaId: "corte",
      nome: "Corte Reto",
      baseCobranca: "UNIDADE",
      estagio: "POS_REFILE",
      custoUnitario: 0.01,
      custoSetup: 0,
      custoMinimo: 15,
    };
    const ctx: ContextoAcabamento = { quantidade: 10, larguraEfetivaM: 0.1, alturaEfetivaM: 0.1 };
    expect(calcularCustoAcabamento(config, ctx).toNumber()).toBe(15);
  });
});
