import { describe, it, expect } from "vitest";
import { agruparPorMaquina } from "./producao-kanban-maquina";

describe("agruparPorMaquina — sub-raias do Kanban por máquina (achado C1)", () => {
  it("agrupa pedidos com a mesma máquina num único grupo", () => {
    const p1 = { id: "1", maquina: { nome: "Prensa 1", parada: false } };
    const p2 = { id: "2", maquina: { nome: "Prensa 1", parada: false } };
    const grupos = agruparPorMaquina([p1, p2]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toEqual({ nome: "Prensa 1", parada: false, pedidos: [p1, p2] });
  });

  it("separa em grupos diferentes por máquina", () => {
    const p1 = { id: "1", maquina: { nome: "Prensa 1", parada: false } };
    const p2 = { id: "2", maquina: { nome: "Prensa 2", parada: false } };
    const grupos = agruparPorMaquina([p1, p2]);
    expect(grupos.map((g) => g.nome)).toEqual(["Prensa 1", "Prensa 2"]);
  });

  it("agrupa pedidos SEM máquina resolvida em 'Sem máquina definida'", () => {
    const p1 = { id: "1", maquina: null };
    const p2 = { id: "2", maquina: null };
    const grupos = agruparPorMaquina([p1, p2]);
    expect(grupos).toEqual([{ nome: "Sem máquina definida", parada: false, pedidos: [p1, p2] }]);
  });

  it("junta cards da mesma máquina mesmo quando NÃO estão contíguos na lista de entrada", () => {
    const p1 = { id: "1", maquina: { nome: "Prensa 1", parada: false } };
    const p2 = { id: "2", maquina: { nome: "Prensa 2", parada: false } };
    const p3 = { id: "3", maquina: { nome: "Prensa 1", parada: false } };
    const grupos = agruparPorMaquina([p1, p2, p3]);
    expect(grupos).toHaveLength(2);
    expect(grupos.find((g) => g.nome === "Prensa 1")?.pedidos).toEqual([p1, p3]);
  });

  it("ordem dos GRUPOS segue a ordem de primeira aparição na lista de entrada", () => {
    const p1 = { id: "1", maquina: { nome: "Prensa 2", parada: false } };
    const p2 = { id: "2", maquina: { nome: "Prensa 1", parada: false } };
    const grupos = agruparPorMaquina([p1, p2]);
    expect(grupos.map((g) => g.nome)).toEqual(["Prensa 2", "Prensa 1"]);
  });

  it("badge de máquina parada aparece quando parada=true", () => {
    const p1 = { id: "1", maquina: { nome: "Prensa 1", parada: true } };
    const grupos = agruparPorMaquina([p1]);
    expect(grupos[0].parada).toBe(true);
  });

  it("badge de máquina parada some quando a máquina volta a operar (parada=false)", () => {
    const p1 = { id: "1", maquina: { nome: "Prensa 1", parada: false } };
    const grupos = agruparPorMaquina([p1]);
    expect(grupos[0].parada).toBe(false);
  });

  it("lista vazia gera lista de grupos vazia", () => {
    expect(agruparPorMaquina([])).toEqual([]);
  });
});
