import { describe, it, expect } from "vitest";
import {
  validarContagemCor,
  normalizarRebobinamento,
  validarMaterialSubstratoOutro,
  ROTULO_REBOBINAMENTO,
  rotuloRebobinamento,
} from "./orcamento-etiqueta";

describe("validarContagemCor", () => {
  it("aceita vazio/ausente como null (campo opcional)", () => {
    expect(validarContagemCor("", "Cores rótulo")).toEqual({ ok: true, valor: null });
    expect(validarContagemCor(null, "Cores rótulo")).toEqual({ ok: true, valor: null });
    expect(validarContagemCor(undefined, "Cores rótulo")).toEqual({ ok: true, valor: null });
  });

  it("aceita inteiro não-negativo", () => {
    expect(validarContagemCor("0", "Cores rótulo")).toEqual({ ok: true, valor: 0 });
    expect(validarContagemCor("4", "Cores rótulo")).toEqual({ ok: true, valor: 4 });
  });

  it("rejeita negativo", () => {
    const resultado = validarContagemCor("-1", "Cores rótulo");
    expect(resultado.ok).toBe(false);
  });

  it("rejeita não-numérico", () => {
    const resultado = validarContagemCor("abc", "Cores rótulo");
    expect(resultado.ok).toBe(false);
  });

  it("rejeita decimal", () => {
    const resultado = validarContagemCor("2.5", "Cores rótulo");
    expect(resultado.ok).toBe(false);
  });
});

describe("normalizarRebobinamento", () => {
  it("aceita vazio como null", () => {
    expect(normalizarRebobinamento("")).toEqual({ ok: true, valor: null });
  });

  it("aceita os limites 1 e 8", () => {
    expect(normalizarRebobinamento("1")).toEqual({ ok: true, valor: 1 });
    expect(normalizarRebobinamento("8")).toEqual({ ok: true, valor: 8 });
  });

  it("rejeita 0", () => {
    expect(normalizarRebobinamento("0").ok).toBe(false);
  });

  it("rejeita 9", () => {
    expect(normalizarRebobinamento("9").ok).toBe(false);
  });

  it("rejeita negativo", () => {
    expect(normalizarRebobinamento("-1").ok).toBe(false);
  });

  it("rejeita não-numérico", () => {
    expect(normalizarRebobinamento("abc").ok).toBe(false);
  });
});

describe("ROTULO_REBOBINAMENTO", () => {
  it("cobre exatamente os valores 1-8, nenhum a mais/menos", () => {
    const chaves = Object.keys(ROTULO_REBOBINAMENTO)
      .map(Number)
      .sort((a, b) => a - b);
    expect(chaves).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("todo rótulo é uma string não-vazia", () => {
    for (let n = 1; n <= 8; n++) {
      expect(typeof ROTULO_REBOBINAMENTO[n]).toBe("string");
      expect(ROTULO_REBOBINAMENTO[n].length).toBeGreaterThan(0);
    }
  });
});

describe("rotuloRebobinamento", () => {
  it("retorna o rótulo cadastrado pra 1-8", () => {
    expect(rotuloRebobinamento(1)).toBe(ROTULO_REBOBINAMENTO[1]);
    expect(rotuloRebobinamento(8)).toBe(ROTULO_REBOBINAMENTO[8]);
  });

  it("cai no fallback 'Posição N' pra um valor fora de 1-8 (dado legado/script)", () => {
    expect(rotuloRebobinamento(99)).toBe("Posição 99");
  });
});

describe("validarMaterialSubstratoOutro", () => {
  it("passa quando não é OUTRO, mesmo sem texto", () => {
    expect(validarMaterialSubstratoOutro("COUCHE_C_ROT", null)).toEqual({ ok: true, valor: true });
  });

  it("passa quando é OUTRO e tem texto", () => {
    expect(validarMaterialSubstratoOutro("OUTRO", "Vinil especial")).toEqual({
      ok: true,
      valor: true,
    });
  });

  it("bloqueia quando é OUTRO sem texto", () => {
    expect(validarMaterialSubstratoOutro("OUTRO", null).ok).toBe(false);
    expect(validarMaterialSubstratoOutro("OUTRO", "").ok).toBe(false);
    expect(validarMaterialSubstratoOutro("OUTRO", "   ").ok).toBe(false);
  });

  it("passa quando materialSubstrato é null (nada selecionado)", () => {
    expect(validarMaterialSubstratoOutro(null, null)).toEqual({ ok: true, valor: true });
  });
});
