import { describe, it, expect } from "vitest";
import {
  NIVEIS_PRIORIDADE_PEDIDO,
  ehNivelPrioridadeValido,
  rotuloPrioridadePedido,
  compararPrioridadePedido,
} from "./prioridade-pedido";

describe("ehNivelPrioridadeValido", () => {
  it("aceita os 4 valores fixos", () => {
    for (const nivel of NIVEIS_PRIORIDADE_PEDIDO) {
      expect(ehNivelPrioridadeValido(nivel.valor)).toBe(true);
    }
  });

  it("rejeita um número livre fora dos 4 valores", () => {
    expect(ehNivelPrioridadeValido(5)).toBe(false);
    expect(ehNivelPrioridadeValido(-1)).toBe(false);
    expect(ehNivelPrioridadeValido(100)).toBe(false);
  });
});

describe("rotuloPrioridadePedido", () => {
  it("rotula os 4 valores fixos", () => {
    expect(rotuloPrioridadePedido(-10)).toBe("Baixa");
    expect(rotuloPrioridadePedido(0)).toBe("Normal");
    expect(rotuloPrioridadePedido(10)).toBe("Alta");
    expect(rotuloPrioridadePedido(20)).toBe("Urgente");
  });

  it("cai num fallback textual pra um valor fora dos 4 fixos (defensivo)", () => {
    expect(rotuloPrioridadePedido(7)).toBe("Prioridade 7");
  });
});

describe("compararPrioridadePedido — ordenação do Kanban (achado C1)", () => {
  const base = { prioridade: 0, prazoEntrega: null as Date | null, createdAt: new Date("2026-01-01") };

  it("prioridade maior vem primeiro (desc)", () => {
    const alta = { ...base, prioridade: 10 };
    const normal = { ...base, prioridade: 0 };
    expect(compararPrioridadePedido(alta, normal)).toBeLessThan(0);
    expect(compararPrioridadePedido(normal, alta)).toBeGreaterThan(0);
  });

  it("com prioridade igual, prazo mais próximo vem primeiro (asc)", () => {
    const cedo = { ...base, prazoEntrega: new Date("2026-01-05") };
    const tarde = { ...base, prazoEntrega: new Date("2026-01-10") };
    expect(compararPrioridadePedido(cedo, tarde)).toBeLessThan(0);
  });

  it("com prioridade igual, quem TEM prazo vem antes de quem não tem", () => {
    const comPrazo = { ...base, prazoEntrega: new Date("2026-01-05") };
    const semPrazo = { ...base, prazoEntrega: null };
    expect(compararPrioridadePedido(comPrazo, semPrazo)).toBeLessThan(0);
    expect(compararPrioridadePedido(semPrazo, comPrazo)).toBeGreaterThan(0);
  });

  it("com prioridade e prazo iguais, o mais antigo (createdAt asc) vem primeiro", () => {
    const antigo = { ...base, createdAt: new Date("2026-01-01") };
    const novo = { ...base, createdAt: new Date("2026-01-02") };
    expect(compararPrioridadePedido(antigo, novo)).toBeLessThan(0);
  });

  it("prioridade sempre vence prazo/data — um Urgente sem prazo passa na frente de um Normal com prazo vencendo hoje", () => {
    const urgenteSemPrazo = { prioridade: 20, prazoEntrega: null, createdAt: new Date("2026-01-10") };
    const normalComPrazoUrgente = {
      prioridade: 0,
      prazoEntrega: new Date("2026-01-01"),
      createdAt: new Date("2026-01-01"),
    };
    expect(compararPrioridadePedido(urgenteSemPrazo, normalComPrazoUrgente)).toBeLessThan(0);
  });

  it("comportamento de HOJE preservado: dois pedidos default (prioridade 0, sem prazo) ordenam só por createdAt", () => {
    const pedidos = [
      { prioridade: 0, prazoEntrega: null, createdAt: new Date("2026-01-03") },
      { prioridade: 0, prazoEntrega: null, createdAt: new Date("2026-01-01") },
      { prioridade: 0, prazoEntrega: null, createdAt: new Date("2026-01-02") },
    ];
    const ordenado = [...pedidos].sort(compararPrioridadePedido);
    expect(ordenado.map((p) => p.createdAt.toISOString())).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ]);
  });

  it("um array misto ordena prioridade primeiro, prazo depois, createdAt por último", () => {
    const urgente = { prioridade: 20, prazoEntrega: null, createdAt: new Date("2026-01-05") };
    const altaComPrazo = { prioridade: 10, prazoEntrega: new Date("2026-01-03"), createdAt: new Date("2026-01-01") };
    const altaSemPrazo = { prioridade: 10, prazoEntrega: null, createdAt: new Date("2026-01-02") };
    const normal = { prioridade: 0, prazoEntrega: null, createdAt: new Date("2026-01-01") };
    const baixa = { prioridade: -10, prazoEntrega: null, createdAt: new Date("2026-01-01") };

    const ordenado = [normal, baixa, altaSemPrazo, urgente, altaComPrazo].sort(compararPrioridadePedido);
    expect(ordenado).toEqual([urgente, altaComPrazo, altaSemPrazo, normal, baixa]);
  });
});
