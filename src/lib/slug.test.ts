import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("deixa tudo minúsculo", () => {
    expect(slugify("Gráfica São José")).toBe("grafica-sao-jose");
  });

  it("remove acentos e cedilha", () => {
    expect(slugify("Impressão & Coração")).toBe("impressao-coracao");
  });

  it("troca espaços e símbolos por hífen, sem duplicar hífen", () => {
    expect(slugify("Gráfica  --  Vitor!!  Ltda.")).toBe("grafica-vitor-ltda");
  });

  it("remove hífen do início e do fim", () => {
    expect(slugify("--teste--")).toBe("teste");
  });

  it("string vazia vira string vazia (chamador decide o fallback)", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!")).toBe("");
  });

  it("números são preservados", () => {
    expect(slugify("Gráfica 2 Irmãos")).toBe("grafica-2-irmaos");
  });
});
