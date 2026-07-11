import { describe, it, expect } from "vitest";
import { loginSchema, senhaSchema, registroSchema } from "./validation";

describe("senhaSchema", () => {
  it("aceita senha forte (10+ chars, maiúscula, minúscula, número)", () => {
    expect(senhaSchema.safeParse("SenhaForte123").success).toBe(true);
  });

  it("rejeita senha curta demais", () => {
    expect(senhaSchema.safeParse("Ab1").success).toBe(false);
  });

  it("rejeita senha sem letra maiúscula", () => {
    expect(senhaSchema.safeParse("senhaforte123").success).toBe(false);
  });

  it("rejeita senha sem letra minúscula", () => {
    expect(senhaSchema.safeParse("SENHAFORTE123").success).toBe(false);
  });

  it("rejeita senha sem número", () => {
    expect(senhaSchema.safeParse("SenhaForteSemNumero").success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("normaliza e-mail pra minúsculo e remove espaços", () => {
    const resultado = loginSchema.safeParse({ email: "  Usuario@Exemplo.COM  ", senha: "qualquer" });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.email).toBe("usuario@exemplo.com");
    }
  });

  it("rejeita e-mail inválido", () => {
    expect(loginSchema.safeParse({ email: "não-é-email", senha: "x" }).success).toBe(false);
  });

  it("rejeita senha vazia (login não valida força, só presença)", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", senha: "" }).success).toBe(false);
  });
});

describe("registroSchema", () => {
  const valido = {
    graficaNome: "Gráfica Teste",
    nome: "Fulano",
    email: "fulano@exemplo.com",
    senha: "SenhaForte123",
  };

  it("aceita cadastro válido", () => {
    expect(registroSchema.safeParse(valido).success).toBe(true);
  });

  it("rejeita nome da gráfica muito curto", () => {
    expect(registroSchema.safeParse({ ...valido, graficaNome: "A" }).success).toBe(false);
  });

  it("rejeita senha fraca (reaproveita senhaSchema)", () => {
    expect(registroSchema.safeParse({ ...valido, senha: "12345678901" }).success).toBe(false);
  });
});
