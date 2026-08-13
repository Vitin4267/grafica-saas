import { describe, it, expect } from "vitest";
import {
  validarArquivoArte,
  extensaoArte,
  validarArquivoLogo,
  extensaoLogo,
} from "./upload-validacao";

describe("validarArquivoArte", () => {
  it("aceita PDF dentro do limite de tamanho", () => {
    expect(validarArquivoArte({ type: "application/pdf", size: 1024 })).toEqual({ ok: true });
  });

  it("aceita JPG e PNG", () => {
    expect(validarArquivoArte({ type: "image/jpeg", size: 1024 }).ok).toBe(true);
    expect(validarArquivoArte({ type: "image/png", size: 1024 }).ok).toBe(true);
  });

  it("rejeita arquivo vazio", () => {
    const resultado = validarArquivoArte({ type: "application/pdf", size: 0 });
    expect(resultado).toEqual({ ok: false, mensagem: "Selecione um arquivo." });
  });

  it("rejeita tipo não permitido (ex: executável disfarçado)", () => {
    const resultado = validarArquivoArte({ type: "application/x-msdownload", size: 1024 });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita arquivo acima de 30MB", () => {
    const resultado = validarArquivoArte({
      type: "application/pdf",
      size: 30 * 1024 * 1024 + 1,
    });
    expect(resultado.ok).toBe(false);
  });

  it("aceita exatamente no limite de 30MB", () => {
    expect(validarArquivoArte({ type: "application/pdf", size: 30 * 1024 * 1024 }).ok).toBe(true);
  });
});

describe("extensaoArte", () => {
  it("mapeia cada tipo MIME pra sua extensão", () => {
    expect(extensaoArte("application/pdf")).toBe("pdf");
    expect(extensaoArte("image/png")).toBe("png");
    expect(extensaoArte("image/jpeg")).toBe("jpg");
  });
});

describe("validarArquivoLogo", () => {
  it("aceita PNG, JPEG e WEBP dentro do limite", () => {
    expect(validarArquivoLogo({ type: "image/png", size: 1024 }).ok).toBe(true);
    expect(validarArquivoLogo({ type: "image/jpeg", size: 1024 }).ok).toBe(true);
    expect(validarArquivoLogo({ type: "image/webp", size: 1024 }).ok).toBe(true);
  });

  it("rejeita SVG (risco de script embutido)", () => {
    const resultado = validarArquivoLogo({ type: "image/svg+xml", size: 1024 });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita arquivo vazio", () => {
    const resultado = validarArquivoLogo({ type: "image/png", size: 0 });
    expect(resultado).toEqual({ ok: false, mensagem: "Selecione uma imagem." });
  });

  it("rejeita imagem acima de 3MB", () => {
    const resultado = validarArquivoLogo({ type: "image/png", size: 3 * 1024 * 1024 + 1 });
    expect(resultado.ok).toBe(false);
  });
});

describe("extensaoLogo", () => {
  it("mapeia cada tipo MIME pra sua extensão", () => {
    expect(extensaoLogo("image/png")).toBe("png");
    expect(extensaoLogo("image/webp")).toBe("webp");
    expect(extensaoLogo("image/jpeg")).toBe("jpg");
  });
});
