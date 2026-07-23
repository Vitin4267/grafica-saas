import { describe, it, expect } from "vitest";
import { escapeHtml, templateEstoqueBaixo } from "./templates";

describe("escapeHtml", () => {
  it("escapa os 5 caracteres especiais de HTML", () => {
    expect(escapeHtml(`<script>alert('x')&"y"</script>`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&amp;&quot;y&quot;&lt;/script&gt;"
    );
  });

  it("não mexe em texto sem caracteres especiais", () => {
    expect(escapeHtml("Papel Couché 300g")).toBe("Papel Couché 300g");
  });
});

// Achado da auditoria de 2026-07-23: nome de item de catálogo ia cru pro
// HTML do e-mail de estoque baixo — um nome tipo "<img src=x onerror=...>"
// não era escapado.
describe("templateEstoqueBaixo — escapa nome de item no HTML", () => {
  it("escapa um nome de item malicioso no corpo HTML", () => {
    const { html } = templateEstoqueBaixo("Gráfica Teste", [
      { nome: "<img src=x onerror=alert(1)>", estoqueAtual: 1, estoqueMinimo: 5, unidade: "un" },
    ]);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("não escapa o texto plano usado no corpo em texto puro", () => {
    const { texto } = templateEstoqueBaixo("Gráfica Teste", [
      { nome: "Papel A4", estoqueAtual: 1, estoqueMinimo: 5, unidade: "un" },
    ]);
    expect(texto).toContain("Papel A4");
  });
});
