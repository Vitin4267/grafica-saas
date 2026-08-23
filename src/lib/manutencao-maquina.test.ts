import { describe, it, expect } from "vitest";
import { indexarManutencoesAtivasPorMaquina, validarSelecaoMaquina } from "./manutencao-maquina";

describe("validarSelecaoMaquina", () => {
  it("aceita só prensaId preenchido", () => {
    expect(validarSelecaoMaquina(["prensa-1", "", "", "", ""])).toEqual({ ok: true });
  });

  it("aceita só maquinaFlexografiaId preenchido", () => {
    expect(validarSelecaoMaquina(["", "maquina-1", "", "", ""])).toEqual({ ok: true });
  });

  it("aceita só equipamentoId preenchido", () => {
    expect(validarSelecaoMaquina(["", "", "equipamento-1", "", ""])).toEqual({ ok: true });
  });

  it("aceita só impressoraDigitalId preenchido (Feature A)", () => {
    expect(validarSelecaoMaquina(["", "", "", "impressora-1", ""])).toEqual({ ok: true });
  });

  it("aceita só maquinaSetupPorPecaId preenchido (Feature A)", () => {
    expect(validarSelecaoMaquina(["", "", "", "", "setup-1"])).toEqual({ ok: true });
  });

  it("rejeita todos vazios", () => {
    const resultado = validarSelecaoMaquina(["", "", "", "", ""]);
    expect(resultado.ok).toBe(false);
  });

  it("rejeita dois preenchidos", () => {
    const resultado = validarSelecaoMaquina(["prensa-1", "maquina-1", "", "", ""]);
    expect(resultado.ok).toBe(false);
  });

  it("rejeita todos preenchidos", () => {
    const resultado = validarSelecaoMaquina([
      "prensa-1",
      "maquina-1",
      "equipamento-1",
      "impressora-1",
      "setup-1",
    ]);
    expect(resultado.ok).toBe(false);
  });

  it("trata espaços em branco como vazio", () => {
    const resultado = validarSelecaoMaquina(["  ", "maquina-1", "", "", ""]);
    expect(resultado.ok).toBe(true);
  });

  it("funciona com um array de tamanho arbitrário, não só 5", () => {
    expect(validarSelecaoMaquina(["a"])).toEqual({ ok: true });
    expect(validarSelecaoMaquina([])).toEqual({ ok: false, mensagem: expect.any(String) });
  });
});

describe("indexarManutencoesAtivasPorMaquina", () => {
  const vazio = {
    prensaId: null,
    maquinaFlexografiaId: null,
    equipamentoId: null,
    impressoraDigitalId: null,
    maquinaSetupPorPecaId: null,
  };

  it("indexa registro de prensa pelo prensaId", () => {
    const registro = { ...vazio, prensaId: "prensa-1" };
    const mapa = indexarManutencoesAtivasPorMaquina([registro]);
    expect(mapa.get("prensa-1")).toBe(registro);
  });

  it("indexa registro de flexografia pelo maquinaFlexografiaId", () => {
    const registro = { ...vazio, maquinaFlexografiaId: "maquina-1" };
    const mapa = indexarManutencoesAtivasPorMaquina([registro]);
    expect(mapa.get("maquina-1")).toBe(registro);
  });

  it("indexa registro de equipamento pelo equipamentoId", () => {
    const registro = { ...vazio, equipamentoId: "equipamento-1" };
    const mapa = indexarManutencoesAtivasPorMaquina([registro]);
    expect(mapa.get("equipamento-1")).toBe(registro);
  });

  it("indexa registro de impressora digital pelo impressoraDigitalId (Feature A)", () => {
    const registro = { ...vazio, impressoraDigitalId: "impressora-1" };
    const mapa = indexarManutencoesAtivasPorMaquina([registro]);
    expect(mapa.get("impressora-1")).toBe(registro);
  });

  it("indexa registro de máquina setup-por-peça pelo maquinaSetupPorPecaId (Feature A)", () => {
    const registro = { ...vazio, maquinaSetupPorPecaId: "setup-1" };
    const mapa = indexarManutencoesAtivasPorMaquina([registro]);
    expect(mapa.get("setup-1")).toBe(registro);
  });

  it("lista vazia gera mapa vazio", () => {
    const mapa = indexarManutencoesAtivasPorMaquina([]);
    expect(mapa.size).toBe(0);
  });

  it("várias máquinas diferentes ficam todas indexadas", () => {
    const registros = [
      { ...vazio, prensaId: "prensa-1" },
      { ...vazio, maquinaFlexografiaId: "maquina-1" },
      { ...vazio, equipamentoId: "equipamento-1" },
      { ...vazio, impressoraDigitalId: "impressora-1" },
      { ...vazio, maquinaSetupPorPecaId: "setup-1" },
    ];
    const mapa = indexarManutencoesAtivasPorMaquina(registros);
    expect(mapa.size).toBe(5);
    expect(mapa.has("prensa-1")).toBe(true);
    expect(mapa.has("maquina-1")).toBe(true);
    expect(mapa.has("equipamento-1")).toBe(true);
    expect(mapa.has("impressora-1")).toBe(true);
    expect(mapa.has("setup-1")).toBe(true);
  });
});
