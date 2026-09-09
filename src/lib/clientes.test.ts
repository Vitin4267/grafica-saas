import { describe, it, expect } from "vitest";
import { clienteSchema } from "./clientes";

describe("clienteSchema", () => {
  it("aceita o mínimo: só nome", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente Teste" });
    expect(resultado.success).toBe(true);
  });

  it("rejeita nome muito curto", () => {
    const resultado = clienteSchema.safeParse({ nome: "A" });
    expect(resultado.success).toBe(false);
  });

  it("rejeita nome ausente", () => {
    const resultado = clienteSchema.safeParse({});
    expect(resultado.success).toBe(false);
  });

  it("e-mail vazio é aceito (campo opcional que aceita string vazia)", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", email: "" });
    expect(resultado.success).toBe(true);
  });

  it("e-mail inválido (não vazio) é rejeitado", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", email: "não-é-email" });
    expect(resultado.success).toBe(false);
  });

  it("e-mail válido é normalizado pra minúsculo", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", email: "Fulano@Exemplo.COM" });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.email).toBe("fulano@exemplo.com");
    }
  });

  it("aceita endereço completo", () => {
    const resultado = clienteSchema.safeParse({
      nome: "Cliente Completo",
      // CPF de teste canônico (dígito verificador válido) — ver
      // src/lib/documento.test.ts. Este teste não é sobre validação de
      // documento, é sobre o schema aceitar um objeto completo.
      documento: "111.444.777-35",
      enderecoCep: "80000000",
      enderecoLogradouro: "Rua X",
      enderecoNumero: "10",
      enderecoBairro: "Centro",
      enderecoMunicipio: "Curitiba",
      enderecoUf: "PR",
    });
    expect(resultado.success).toBe(true);
  });

  it("documento vazio é aceito (campo opcional que aceita string vazia)", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", documento: "" });
    expect(resultado.success).toBe(true);
  });

  it("documento ausente é aceito", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente" });
    expect(resultado.success).toBe(true);
  });

  it("normaliza pontuação do documento sem rejeitar (CPF válido formatado)", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", documento: "111.444.777-35" });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.documento).toBe("11144477735");
    }
  });

  it("aceita CNPJ numérico válido e normaliza pontuação", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", documento: "11.222.333/0001-81" });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.documento).toBe("11222333000181");
    }
  });

  it("aceita CNPJ alfanumérico válido (padrão Serpro) e normaliza pra maiúsculo", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", documento: "pc.3d3.15k/0001-93" });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.documento).toBe("PC3D315K000193");
    }
  });

  it("rejeita CPF com dígito verificador inválido", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", documento: "111.444.777-99" });
    expect(resultado.success).toBe(false);
  });

  it("rejeita CNPJ com dígito verificador inválido", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", documento: "11.222.333/0001-99" });
    expect(resultado.success).toBe(false);
  });

  it("rejeita documento com comprimento que não é nem CPF (11) nem CNPJ (14)", () => {
    const resultado = clienteSchema.safeParse({ nome: "Cliente", documento: "123456" });
    expect(resultado.success).toBe(false);
  });
});
