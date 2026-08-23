import { describe, it, expect } from "vitest";
import { indexarManutencoesAtivasPorMaquina, validarSelecaoMaquina } from "./manutencao-maquina";

describe("validarSelecaoMaquina", () => {
  it("aceita só prensaId preenchido", () => {
    expect(validarSelecaoMaquina("prensa-1", "", "")).toEqual({ ok: true });
  });

  it("aceita só maquinaFlexografiaId preenchido", () => {
    expect(validarSelecaoMaquina("", "maquina-1", "")).toEqual({ ok: true });
  });

  it("aceita só equipamentoId preenchido", () => {
    expect(validarSelecaoMaquina("", "", "equipamento-1")).toEqual({ ok: true });
  });

  it("rejeita os três vazios", () => {
    const resultado = validarSelecaoMaquina("", "", "");
    expect(resultado.ok).toBe(false);
  });

  it("rejeita dois preenchidos", () => {
    const resultado = validarSelecaoMaquina("prensa-1", "maquina-1", "");
    expect(resultado.ok).toBe(false);
  });

  it("rejeita os três preenchidos", () => {
    const resultado = validarSelecaoMaquina("prensa-1", "maquina-1", "equipamento-1");
    expect(resultado.ok).toBe(false);
  });

  it("trata espaços em branco como vazio", () => {
    const resultado = validarSelecaoMaquina("  ", "maquina-1", "");
    expect(resultado.ok).toBe(true);
  });
});

describe("indexarManutencoesAtivasPorMaquina", () => {
  it("indexa registro de prensa pelo prensaId", () => {
    const registro = { prensaId: "prensa-1", maquinaFlexografiaId: null, equipamentoId: null };
    const mapa = indexarManutencoesAtivasPorMaquina([registro]);
    expect(mapa.get("prensa-1")).toBe(registro);
  });

  it("indexa registro de flexografia pelo maquinaFlexografiaId", () => {
    const registro = { prensaId: null, maquinaFlexografiaId: "maquina-1", equipamentoId: null };
    const mapa = indexarManutencoesAtivasPorMaquina([registro]);
    expect(mapa.get("maquina-1")).toBe(registro);
  });

  it("indexa registro de equipamento pelo equipamentoId", () => {
    const registro = { prensaId: null, maquinaFlexografiaId: null, equipamentoId: "equipamento-1" };
    const mapa = indexarManutencoesAtivasPorMaquina([registro]);
    expect(mapa.get("equipamento-1")).toBe(registro);
  });

  it("lista vazia gera mapa vazio", () => {
    const mapa = indexarManutencoesAtivasPorMaquina([]);
    expect(mapa.size).toBe(0);
  });

  it("várias máquinas diferentes ficam todas indexadas", () => {
    const registros = [
      { prensaId: "prensa-1", maquinaFlexografiaId: null, equipamentoId: null },
      { prensaId: null, maquinaFlexografiaId: "maquina-1", equipamentoId: null },
      { prensaId: null, maquinaFlexografiaId: null, equipamentoId: "equipamento-1" },
    ];
    const mapa = indexarManutencoesAtivasPorMaquina(registros);
    expect(mapa.size).toBe(3);
    expect(mapa.has("prensa-1")).toBe(true);
    expect(mapa.has("maquina-1")).toBe(true);
    expect(mapa.has("equipamento-1")).toBe(true);
  });
});
