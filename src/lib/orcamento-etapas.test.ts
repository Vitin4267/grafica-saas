import { describe, it, expect } from "vitest";
import {
  ETAPAS_ORCAMENTO,
  nomeCampoEtapaEm,
  nomeCampoEtapaResponsavel,
} from "./orcamento-etapas";

describe("ETAPAS_ORCAMENTO", () => {
  it("tem exatamente 5 etapas", () => {
    expect(ETAPAS_ORCAMENTO).toHaveLength(5);
  });

  it("todas as chaves são únicas", () => {
    const chaves = ETAPAS_ORCAMENTO.map((e) => e.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("todos os rótulos são únicos", () => {
    const rotulos = ETAPAS_ORCAMENTO.map((e) => e.rotulo);
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });
});

describe("nomeCampoEtapaEm / nomeCampoEtapaResponsavel", () => {
  it("gera os nomes de campo esperados pra cada etapa, batendo com o schema", () => {
    expect(nomeCampoEtapaEm("orcamentoDesenvolvimento")).toBe("etapaOrcamentoDesenvolvimentoEm");
    expect(nomeCampoEtapaResponsavel("orcamentoDesenvolvimento")).toBe(
      "etapaOrcamentoDesenvolvimentoResponsavel"
    );
    expect(nomeCampoEtapaEm("layout")).toBe("etapaLayoutEm");
    expect(nomeCampoEtapaResponsavel("layout")).toBe("etapaLayoutResponsavel");
    expect(nomeCampoEtapaEm("aprovacao")).toBe("etapaAprovacaoEm");
    expect(nomeCampoEtapaResponsavel("aprovacao")).toBe("etapaAprovacaoResponsavel");
    expect(nomeCampoEtapaEm("confirmacaoPedido")).toBe("etapaConfirmacaoPedidoEm");
    expect(nomeCampoEtapaResponsavel("confirmacaoPedido")).toBe("etapaConfirmacaoPedidoResponsavel");
    expect(nomeCampoEtapaEm("entrega")).toBe("etapaEntregaEm");
    expect(nomeCampoEtapaResponsavel("entrega")).toBe("etapaEntregaResponsavel");
  });
});
