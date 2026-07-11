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
      documento: "12345678900",
      enderecoCep: "80000000",
      enderecoLogradouro: "Rua X",
      enderecoNumero: "10",
      enderecoBairro: "Centro",
      enderecoMunicipio: "Curitiba",
      enderecoUf: "PR",
    });
    expect(resultado.success).toBe(true);
  });
});
