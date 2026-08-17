import { describe, it, expect } from "vitest";
// escritor-clientes.ts reusa clienteSchema DIRETO (byte-a-byte, mesmo do
// cadastro manual em src/app/clientes/actions.ts) em vez de definir o
// próprio — então é isso que testamos aqui: o comportamento de validação que
// o writer efetivamente usa, sem precisar de `tx`/Prisma real. `linha` chega
// do importador como Record<string,string> só com as chaves MAPEADAS
// presentes (ver aplicarMapeamento em planilha.ts) — simulado abaixo
// omitindo chaves em vez de mandar string vazia.
import { clienteSchema } from "@/lib/clientes";

describe("escritor-clientes: validação (clienteSchema reusado)", () => {
  it("aceita linha só com nome (todos os outros campos ausentes)", () => {
    const resultado = clienteSchema.safeParse({ nome: "Fulano de Tal" });
    expect(resultado.success).toBe(true);
  });

  it("rejeita nome ausente", () => {
    const resultado = clienteSchema.safeParse({ email: "fulano@teste.com" });
    expect(resultado.success).toBe(false);
  });

  it("rejeita nome muito curto", () => {
    const resultado = clienteSchema.safeParse({ nome: "A" });
    expect(resultado.success).toBe(false);
  });

  it("aceita e normaliza e-mail válido (trim + lowercase)", () => {
    const resultado = clienteSchema.safeParse({ nome: "Fulano", email: "  FULANO@Teste.com  " });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.email).toBe("fulano@teste.com");
  });

  it("rejeita e-mail inválido", () => {
    const resultado = clienteSchema.safeParse({ nome: "Fulano", email: "não-é-email" });
    expect(resultado.success).toBe(false);
  });

  it.each([
    ["00000-000", true],
    ["00000000", true],
    ["123", false],
    ["abcde-000", false],
  ])("CEP %s -> válido=%s", (cep, esperado) => {
    const resultado = clienteSchema.safeParse({ nome: "Fulano", enderecoCep: cep });
    expect(resultado.success).toBe(esperado);
  });

  it("aceita todos os campos de endereço presentes de uma vez", () => {
    const resultado = clienteSchema.safeParse({
      nome: "Fulano de Tal",
      telefone: "11999999999",
      documento: "12345678900",
      enderecoCep: "01310-100",
      enderecoLogradouro: "Av. Paulista",
      enderecoNumero: "1000",
      enderecoComplemento: "Sala 1",
      enderecoBairro: "Bela Vista",
      enderecoMunicipio: "São Paulo",
      enderecoUf: "SP",
    });
    expect(resultado.success).toBe(true);
  });
});
