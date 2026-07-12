import { describe, it, expect } from "vitest";
import { construirEnvelope } from "./webhook-envelope";

describe("construirEnvelope", () => {
  it("gera idEvento prefixado com evt_ e único entre chamadas", () => {
    const a = construirEnvelope("teste", { x: 1 });
    const b = construirEnvelope("teste", { x: 1 });
    expect(a.idEvento).toMatch(/^evt_[0-9a-f-]+$/);
    expect(a.idEvento).not.toBe(b.idEvento);
  });

  it("timestamp é um ISO 8601 válido", () => {
    const evento = construirEnvelope("teste", {});
    expect(new Date(evento.timestamp).toISOString()).toBe(evento.timestamp);
  });

  it("versao é sempre 1", () => {
    expect(construirEnvelope("teste", {}).versao).toBe(1);
  });

  it("repassa tipo e dados sem alterar", () => {
    const dados = { pergunta: "oi", pagina: "Clientes" };
    const evento = construirEnvelope("pergunta_assistente", dados);
    expect(evento.tipo).toBe("pergunta_assistente");
    expect(evento.dados).toEqual(dados);
  });
});
