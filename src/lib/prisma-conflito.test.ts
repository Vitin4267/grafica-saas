import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { ehConflitoDeSerializacao, ehViolacaoDeUnicidade } from "./prisma-conflito";

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
