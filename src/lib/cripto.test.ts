import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cifrar, decifrar, cifrarOuNull, decifrarOuNull, ultimosCaracteres } from "./cripto";
import { randomBytes } from "node:crypto";

const CHAVE_ORIGINAL = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterEach(() => {
  if (CHAVE_ORIGINAL === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = CHAVE_ORIGINAL;
});

describe("cifrar/decifrar — round-trip", () => {
  it("decifra de volta o texto original", () => {
    const original = "TOKEN-SECRETO-DA-FOCUS-NFE-abc123";
    const cifrado = cifrar(original);
    expect(decifrar(cifrado)).toBe(original);
  });

  it("preserva texto com caracteres especiais/unicode", () => {
    const original = "token://com?query=1&acento=ção€";
    expect(decifrar(cifrar(original))).toBe(original);
  });

  it("preserva string longa (URL de webhook)", () => {
    const original = "https://n8n.exemplo.com/webhook/" + "a".repeat(500);
    expect(decifrar(cifrar(original))).toBe(original);
  });
});

describe("cifrar — não determinístico de propósito", () => {
  it("cifra o mesmo texto duas vezes produz saídas diferentes (IV aleatório)", () => {
    const original = "mesmo-token";
    const cifrado1 = cifrar(original);
    const cifrado2 = cifrar(original);
    expect(cifrado1).not.toBe(cifrado2);
    // mas os dois decifram pro mesmo texto
    expect(decifrar(cifrado1)).toBe(original);
    expect(decifrar(cifrado2)).toBe(original);
  });

  it("tem o prefixo de versão", () => {
    expect(cifrar("x")).toMatch(/^v1:/);
  });
});

describe("decifrar — rejeita adulteração (autenticado)", () => {
  it("lança se o texto cifrado foi alterado", () => {
    const cifrado = cifrar("token-original");
    const partes = cifrado.split(":");
    // corrompe o último byte do texto cifrado (não o IV nem a tag)
    const bufCifrado = Buffer.from(partes[3], "base64");
    bufCifrado[bufCifrado.length - 1] ^= 0xff;
    const adulterado = [partes[0], partes[1], partes[2], bufCifrado.toString("base64")].join(":");
    expect(() => decifrar(adulterado)).toThrow();
  });

  it("lança se o authTag foi alterado", () => {
    const cifrado = cifrar("token-original");
    const partes = cifrado.split(":");
    const bufTag = Buffer.from(partes[2], "base64");
    bufTag[0] ^= 0xff;
    const adulterado = [partes[0], partes[1], bufTag.toString("base64"), partes[3]].join(":");
    expect(() => decifrar(adulterado)).toThrow();
  });

  it("lança pra formato desconhecido", () => {
    expect(() => decifrar("nao-e-um-valor-cifrado")).toThrow();
    expect(() => decifrar("v2:a:b:c")).toThrow();
  });
});

describe("decifrar — rejeita chave errada", () => {
  it("lança quando decifrado com outra chave", () => {
    const cifrado = cifrar("token-original");
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64"); // troca a chave
    expect(() => decifrar(cifrado)).toThrow();
  });
});

describe("ENCRYPTION_KEY ausente/inválida — falha alto", () => {
  it("lança ao cifrar sem ENCRYPTION_KEY", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => cifrar("x")).toThrow(/ENCRYPTION_KEY não configurada/);
  });

  it("lança ao decifrar sem ENCRYPTION_KEY", () => {
    const cifrado = cifrar("x");
    delete process.env.ENCRYPTION_KEY;
    expect(() => decifrar(cifrado)).toThrow(/ENCRYPTION_KEY não configurada/);
  });

  it("lança com chave de tamanho errado", () => {
    process.env.ENCRYPTION_KEY = Buffer.from("chave-curta-demais").toString("base64");
    expect(() => cifrar("x")).toThrow(/32 bytes/);
  });
});

describe("cifrarOuNull / decifrarOuNull — campo opcional", () => {
  it("null/undefined/string vazia viram null, nunca cifram", () => {
    expect(cifrarOuNull(null)).toBeNull();
    expect(cifrarOuNull(undefined)).toBeNull();
    expect(cifrarOuNull("")).toBeNull();
  });

  it("decifrarOuNull(null) é null sem chamar decifrar", () => {
    delete process.env.ENCRYPTION_KEY; // se tentasse decifrar, lançaria
    expect(decifrarOuNull(null)).toBeNull();
    expect(decifrarOuNull(undefined)).toBeNull();
  });

  it("round-trip completo via os helpers nullable", () => {
    const cifrado = cifrarOuNull("valor-real");
    expect(cifrado).not.toBeNull();
    expect(decifrarOuNull(cifrado)).toBe("valor-real");
  });
});

describe("ultimosCaracteres", () => {
  it("pega os últimos N caracteres do texto em claro", () => {
    expect(ultimosCaracteres("abcd1234", 4)).toBe("1234");
  });

  it("texto mais curto que a quantidade pedida devolve o texto inteiro", () => {
    expect(ultimosCaracteres("ab", 4)).toBe("ab");
  });
});
