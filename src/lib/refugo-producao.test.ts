import { describe, it, expect } from "vitest";
import {
  ROTULOS_MOTIVO_REFUGO,
  ORDEM_MOTIVO_REFUGO,
  rotuloMotivoRefugo,
  refugoGeraCustoAutomatico,
  calcularBaixaRefugoLinha,
  parseRefugoFormData,
} from "./refugo-producao";

describe("rotuloMotivoRefugo", () => {
  it("resolve 'Outro: <texto>' quando motivo=OUTRO e motivoOutro preenchido", () => {
    expect(rotuloMotivoRefugo("OUTRO", "Queda de energia no meio do turno")).toBe(
      "Queda de energia no meio do turno"
    );
  });

  it("cai no rótulo fixo quando motivo != OUTRO", () => {
    expect(rotuloMotivoRefugo("FALHA_IMPRESSAO", null)).toBe(ROTULOS_MOTIVO_REFUGO.FALHA_IMPRESSAO);
  });

  it("cai no rótulo fixo 'Outro' quando motivo=OUTRO sem motivoOutro", () => {
    expect(rotuloMotivoRefugo("OUTRO", null)).toBe("Outro");
  });
});

describe("refugoGeraCustoAutomatico — MATERIAL_DEFEITUOSO é o único motivo que NUNCA gera CustoPedido automático", () => {
  it("MATERIAL_DEFEITUOSO nunca gera custo automático", () => {
    expect(refugoGeraCustoAutomatico("MATERIAL_DEFEITUOSO")).toBe(false);
  });

  it.each(ORDEM_MOTIVO_REFUGO.filter((m) => m !== "MATERIAL_DEFEITUOSO"))(
    "%s gera custo automático normalmente",
    (motivo) => {
      expect(refugoGeraCustoAutomatico(motivo)).toBe(true);
    }
  );

  it("null (não informado) gera custo automático normalmente", () => {
    expect(refugoGeraCustoAutomatico(null)).toBe(true);
  });
});

describe("calcularBaixaRefugoLinha", () => {
  it("calcula a baixa proporcional: consumo por unidade × refugo", () => {
    // 10 unidades no item consomem 50 no total → 5 por unidade; 3 refugadas → 15.
    const baixa = calcularBaixaRefugoLinha(
      { quantidadeConsumidaTotal: 50, quantidadeItemPedido: 10 },
      3
    );
    expect(baixa).toBe(15);
  });

  it("devolve 0 quando quantidadeRefugo é 0 ou negativo", () => {
    expect(calcularBaixaRefugoLinha({ quantidadeConsumidaTotal: 50, quantidadeItemPedido: 10 }, 0)).toBe(0);
    expect(calcularBaixaRefugoLinha({ quantidadeConsumidaTotal: 50, quantidadeItemPedido: 10 }, -3)).toBe(0);
  });

  it("devolve 0 em vez de dividir por zero quando quantidadeItemPedido é 0", () => {
    expect(calcularBaixaRefugoLinha({ quantidadeConsumidaTotal: 50, quantidadeItemPedido: 0 }, 3)).toBe(0);
  });
});

function formData(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

describe("parseRefugoFormData", () => {
  it("devolve refugo=null quando nenhum campo relevante veio preenchido (comportamento de hoje)", () => {
    const resultado = parseRefugoFormData(formData({}));
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.refugo).toBeNull();
  });

  it("aceita quantidadeBoa sozinho, sem refugo nenhum — gerarBaixaEstoque sempre false sem o checkbox", () => {
    const resultado = parseRefugoFormData(formData({ quantidadeBoa: "1000" }));
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.refugo).toEqual({
        quantidadeBoa: 1000,
        quantidadeRefugo: null,
        motivoRefugo: null,
        motivoRefugoOutro: null,
        gerarBaixaEstoque: false,
      });
    }
  });

  it("exige motivo quando quantidadeRefugo > 0", () => {
    const resultado = parseRefugoFormData(formData({ quantidadeBoa: "990", quantidadeRefugo: "10" }));
    expect(resultado.ok).toBe(false);
  });

  it("aceita refugo com motivo, sem exigir baixa de estoque (checkbox desmarcado por padrão)", () => {
    const resultado = parseRefugoFormData(
      formData({ quantidadeBoa: "990", quantidadeRefugo: "10", motivoRefugo: "FALHA_IMPRESSAO" })
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.refugo?.quantidadeRefugo).toBe(10);
      expect(resultado.refugo?.motivoRefugo).toBe("FALHA_IMPRESSAO");
      expect(resultado.refugo?.gerarBaixaEstoque).toBe(false);
    }
  });

  it("liga gerarBaixaEstoque só quando o checkbox vem 'on'", () => {
    const resultado = parseRefugoFormData(
      formData({
        quantidadeBoa: "990",
        quantidadeRefugo: "10",
        motivoRefugo: "FALHA_IMPRESSAO",
        gerarBaixaRefugo: "on",
      })
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.refugo?.gerarBaixaEstoque).toBe(true);
  });

  it("exige motivoRefugoOutro quando motivo=OUTRO", () => {
    const resultado = parseRefugoFormData(
      formData({ quantidadeBoa: "990", quantidadeRefugo: "10", motivoRefugo: "OUTRO" })
    );
    expect(resultado.ok).toBe(false);
  });

  it("aceita motivo=OUTRO com motivoRefugoOutro preenchido", () => {
    const resultado = parseRefugoFormData(
      formData({
        quantidadeBoa: "990",
        quantidadeRefugo: "10",
        motivoRefugo: "OUTRO",
        motivoRefugoOutro: "Queda de energia",
      })
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.refugo?.motivoRefugoOutro).toBe("Queda de energia");
  });

  it("rejeita motivo inválido (nunca confia em valor vindo direto do form)", () => {
    const resultado = parseRefugoFormData(
      formData({ quantidadeBoa: "990", quantidadeRefugo: "10", motivoRefugo: "NAO_EXISTE" })
    );
    expect(resultado.ok).toBe(false);
  });

  it("rejeita quantidade negativa", () => {
    const resultado = parseRefugoFormData(formData({ quantidadeBoa: "-5" }));
    expect(resultado.ok).toBe(false);
  });

  it("quantidadeRefugo=0 explícito não exige motivo (mesmo que o campo tenha sido submetido)", () => {
    const resultado = parseRefugoFormData(formData({ quantidadeBoa: "1000", quantidadeRefugo: "0" }));
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.refugo?.quantidadeRefugo).toBe(0);
      expect(resultado.refugo?.motivoRefugo).toBeNull();
    }
  });
});
