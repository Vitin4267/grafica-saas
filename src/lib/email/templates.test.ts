import { describe, it, expect } from "vitest";
import { escapeHtml, templateEstoqueBaixo, templateArteAlteracaoSolicitada } from "./templates";

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

// comentario e clienteNome vêm de um formulário PÚBLICO sem autenticação
// (/a/[token]) — precisam de escapeHtml no HTML pelo mesmo motivo do nome de
// item em templateEstoqueBaixo.
describe("templateArteAlteracaoSolicitada", () => {
  it("escapa o comentário do cliente no corpo HTML", () => {
    const { html } = templateArteAlteracaoSolicitada(
      "Gráfica Teste",
      "Cliente Normal",
      "<img src=x onerror=alert(1)>",
      "https://app.exemplo/producao"
    );
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapa o nome do cliente no corpo HTML", () => {
    const { html } = templateArteAlteracaoSolicitada(
      "Gráfica Teste",
      "<script>alert(1)</script>",
      "muda a cor",
      "https://app.exemplo/producao"
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("inclui o link de produção e o comentário no texto puro", () => {
    const { texto } = templateArteAlteracaoSolicitada(
      "Gráfica Teste",
      "Cliente Normal",
      "muda a cor pra azul",
      "https://app.exemplo/producao"
    );
    expect(texto).toContain("muda a cor pra azul");
    expect(texto).toContain("https://app.exemplo/producao");
  });
});
