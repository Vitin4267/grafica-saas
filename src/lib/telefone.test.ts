import { describe, it, expect } from "vitest";
import { linkWhatsApp } from "./telefone";

describe("linkWhatsApp", () => {
  it("retorna null quando telefone é null/undefined/vazio", () => {
    expect(linkWhatsApp(null, "oi")).toBeNull();
    expect(linkWhatsApp(undefined, "oi")).toBeNull();
    expect(linkWhatsApp("", "oi")).toBeNull();
  });

  it("adiciona DDI 55 a um número de 11 dígitos (celular com 9)", () => {
    const url = linkWhatsApp("(41) 99123-4567", "Olá!");
    expect(url).toBe("https://wa.me/5541991234567?text=Ol%C3%A1!");
  });

  it("adiciona DDI 55 a um número de 10 dígitos (fixo)", () => {
    const url = linkWhatsApp("41 3123-4567", "oi");
    expect(url).toBe("https://wa.me/554131234567?text=oi");
  });

  it("não duplica o DDI quando o número já vem com 55 e 13 dígitos", () => {
    const url = linkWhatsApp("55 41 99123-4567", "oi");
    expect(url).toBe("https://wa.me/5541991234567?text=oi");
  });

  it("retorna null pra número curto demais (não é nem local nem com DDI plausível)", () => {
    expect(linkWhatsApp("123", "oi")).toBeNull();
  });

  it("retorna null pra número longo demais", () => {
    expect(linkWhatsApp("551141991234567890", "oi")).toBeNull();
  });

  it("codifica a mensagem na URL", () => {
    const url = linkWhatsApp("41991234567", "Olá & tudo bem?");
    expect(url).toContain(encodeURIComponent("Olá & tudo bem?"));
  });
});
