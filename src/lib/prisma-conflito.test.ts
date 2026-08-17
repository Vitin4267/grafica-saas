import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { ehConflitoDeSerializacao, ehViolacaoDeUnicidade, ehViolacaoDeChaveEstrangeira } from "./prisma-conflito";

describe("ehConflitoDeSerializacao", () => {
  it("reconhece PrismaClientKnownRequestError com código P2034", () => {
    const erro = new Prisma.PrismaClientKnownRequestError("conflito", {
      code: "P2034",
      clientVersion: "7.9.0",
    });
    expect(ehConflitoDeSerializacao(erro)).toBe(true);
  });

  it("NÃO reconhece PrismaClientKnownRequestError com outro código", () => {
    const erro = new Prisma.PrismaClientKnownRequestError("não encontrado", {
      code: "P2025",
      clientVersion: "7.9.0",
    });
    expect(ehConflitoDeSerializacao(erro)).toBe(false);
  });

  // Achado da auditoria de 2026-07-23 (confirmado empiricamente contra o
  // banco de verdade): com @prisma/adapter-pg, um conflito de serialização
  // real (SQLSTATE 40001) NÃO chega como PrismaClientKnownRequestError(P2034)
  // — chega como este objeto cru do driver adapter. Sem este segundo check,
  // o conflito escapava como erro 500 não tratado em qualquer fluxo que usa
  // isolamento Serializable (login, producao, orcamento).
  it("reconhece o DriverAdapterError cru do @prisma/adapter-pg (TransactionWriteConflict)", () => {
    const erro = { name: "DriverAdapterError", cause: { kind: "TransactionWriteConflict" } };
    expect(ehConflitoDeSerializacao(erro)).toBe(true);
  });

  it("NÃO reconhece um DriverAdapterError de outro tipo", () => {
    const erro = { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation" } };
    expect(ehConflitoDeSerializacao(erro)).toBe(false);
  });

  it("não quebra com valores estranhos (null, string, objeto vazio)", () => {
    expect(ehConflitoDeSerializacao(null)).toBe(false);
    expect(ehConflitoDeSerializacao("erro qualquer")).toBe(false);
    expect(ehConflitoDeSerializacao({})).toBe(false);
    expect(ehConflitoDeSerializacao(new Error("erro genérico"))).toBe(false);
  });
});

describe("ehViolacaoDeUnicidade", () => {
  it("reconhece código P2002", () => {
    const erro = new Prisma.PrismaClientKnownRequestError("duplicado", {
      code: "P2002",
      clientVersion: "7.9.0",
    });
    expect(ehViolacaoDeUnicidade(erro)).toBe(true);
  });

  it("NÃO reconhece outro código", () => {
    const erro = new Prisma.PrismaClientKnownRequestError("conflito", {
      code: "P2034",
      clientVersion: "7.9.0",
    });
    expect(ehViolacaoDeUnicidade(erro)).toBe(false);
  });
});

describe("ehViolacaoDeChaveEstrangeira", () => {
  it("reconhece código P2003", () => {
    const erro = new Prisma.PrismaClientKnownRequestError("violação de FK", {
      code: "P2003",
      clientVersion: "7.9.0",
    });
    expect(ehViolacaoDeChaveEstrangeira(erro)).toBe(true);
  });

  it("NÃO reconhece outro código", () => {
    const erro = new Prisma.PrismaClientKnownRequestError("duplicado", {
      code: "P2002",
      clientVersion: "7.9.0",
    });
    expect(ehViolacaoDeChaveEstrangeira(erro)).toBe(false);
  });

  // Achado excluindo Prensa/Cliente em uso, confirmado empiricamente contra o
  // banco de verdade (mesmo jeito do achado de ehConflitoDeSerializacao):
  // violação de RESTRICT no DELETE nunca chega como PrismaClientKnownRequestError
  // P2003 com @prisma/adapter-pg — chega como DriverAdapterError cru com o
  // SQLSTATE do Postgres na causa. Sem este check, excluir uma prensa/cliente
  // ainda em uso escapava como erro 500 em vez da mensagem amigável.
  it("reconhece o DriverAdapterError cru do @prisma/adapter-pg (SQLSTATE 23001, restrict_violation)", () => {
    const erro = { name: "DriverAdapterError", cause: { code: "23001" } };
    expect(ehViolacaoDeChaveEstrangeira(erro)).toBe(true);
  });

  it("reconhece o DriverAdapterError cru do @prisma/adapter-pg (SQLSTATE 23503, foreign_key_violation)", () => {
    const erro = { name: "DriverAdapterError", cause: { code: "23503" } };
    expect(ehViolacaoDeChaveEstrangeira(erro)).toBe(true);
  });

  it("NÃO reconhece um DriverAdapterError de outro código", () => {
    const erro = { name: "DriverAdapterError", cause: { code: "23505" } };
    expect(ehViolacaoDeChaveEstrangeira(erro)).toBe(false);
  });

  it("não quebra com valores estranhos (null, string, objeto vazio)", () => {
    expect(ehViolacaoDeChaveEstrangeira(null)).toBe(false);
    expect(ehViolacaoDeChaveEstrangeira("erro qualquer")).toBe(false);
    expect(ehViolacaoDeChaveEstrangeira({})).toBe(false);
    expect(ehViolacaoDeChaveEstrangeira(new Error("erro genérico"))).toBe(false);
  });
});
