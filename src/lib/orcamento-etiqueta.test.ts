import { describe, it, expect } from "vitest";
import {
  validarContagemCor,
  normalizarRebobinamento,
  validarMaterialSubstratoOutro,
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
