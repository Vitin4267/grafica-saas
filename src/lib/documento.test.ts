import { describe, it, expect } from "vitest";
import { normalizarDocumento, validarCpf, validarCnpj } from "./documento";

describe("normalizarDocumento", () => {
  it("remove pontuação e mantém dígitos", () => {
    expect(normalizarDocumento("111.444.777-35")).toBe("11144477735");
  });

  it("remove pontuação e maiúsculiza letras (CNPJ alfanumérico)", () => {
    expect(normalizarDocumento("pc.3d3.15k/0001-93")).toBe("PC3D315K000193");
  });

  it("string vazia continua vazia", () => {
    expect(normalizarDocumento("")).toBe("");
  });
});

describe("validarCpf", () => {
  // 111.444.777-35 é o CPF de teste canônico usado por praticamente todo
  // validador de mercado (base 111.444.777 + DV 35) — recalculado à mão
  // aqui pra conferir o algoritmo antes de confiar no fixture:
  // DV1: soma ponderada (pesos 10..2) = 162, 162%11=8, 11-8=3.
  // DV2: soma ponderada (pesos 11..2, com DV1=3) = 204, 204%11=6, 11-6=5.
  it("aceita CPF válido formatado", () => {
    expect(validarCpf("111.444.777-35")).toBe(true);
  });

  it("aceita o mesmo CPF sem pontuação", () => {
    expect(validarCpf("11144477735")).toBe(true);
  });

  it("rejeita CPF com dígito verificador errado", () => {
    expect(validarCpf("111.444.777-36")).toBe(false);
  });

  it("rejeita sequência de dígitos repetidos (checksum bateria, mas é CPF sabidamente falso)", () => {
    expect(validarCpf("111.111.111-11")).toBe(false);
    expect(validarCpf("00000000000")).toBe(false);
  });

  it("rejeita comprimento diferente de 11 dígitos", () => {
    expect(validarCpf("123456789")).toBe(false);
  });

  it("rejeita texto não numérico", () => {
    expect(validarCpf("abcdefghijk")).toBe(false);
  });
});

describe("validarCnpj — numérico", () => {
  // 11.222.333/0001-81 é o CNPJ de teste canônico usado por praticamente
  // todo validador de mercado — recalculado à mão:
  // DV1: soma ponderada (pesos 5,4,3,2,9,8,7,6,5,4,3,2) = 102, 102%11=3, 11-3=8.
  // DV2: soma ponderada (pesos 6,5,4,3,2,9,8,7,6,5,4,3,2, com DV1=8) = 120, 120%11=10, 11-10=1.
  it("aceita CNPJ numérico válido formatado", () => {
    expect(validarCnpj("11.222.333/0001-81")).toBe(true);
  });

  it("aceita o mesmo CNPJ sem pontuação", () => {
    expect(validarCnpj("11222333000181")).toBe(true);
  });

  it("rejeita CNPJ numérico com dígito verificador errado", () => {
    expect(validarCnpj("11.222.333/0001-82")).toBe(false);
  });

  it("rejeita sequência de 14 dígitos repetidos", () => {
    expect(validarCnpj("11.111.111/1111-11")).toBe(false);
    expect(validarCnpj("00000000000000")).toBe(false);
  });

  it("rejeita comprimento diferente de 14 posições", () => {
    expect(validarCnpj("1122233300018")).toBe(false);
  });
});

describe("validarCnpj — alfanumérico (padrão Serpro, vigente desde 31/07/2026)", () => {
  // "PC3D315K000193" é o vetor de teste oficial divulgado pela Receita
  // Federal/Serpro pro cálculo do DV do CNPJ alfanumérico — recalculado à
  // mão (valor de cada caractere = código ASCII - 48; A=17...Z=42):
  // base "PC3D315K0001" com pesos 5,4,3,2,9,8,7,6,5,4,3,2 -> soma 519,
  // 519%11=2, 11-2=9 (1º DV).
  // base+DV1 "PC3D315K00019" com pesos 6,5,4,3,2,9,8,7,6,5,4,3,2 -> soma
  // 624, 624%11=8, 11-8=3 (2º DV) — bate com "93".
  it("aceita CNPJ alfanumérico válido (vetor de teste oficial Serpro)", () => {
    expect(validarCnpj("PC3D315K000193")).toBe(true);
  });

  it("aceita o mesmo CNPJ alfanumérico em minúsculo e com pontuação (normaliza antes de validar)", () => {
    expect(validarCnpj("pc.3d3.15k/0001-93")).toBe(true);
  });

  it("rejeita CNPJ alfanumérico com dígito verificador errado", () => {
    expect(validarCnpj("PC3D315K000194")).toBe(false);
  });

  it("rejeita CNPJ alfanumérico com letra numa das 12 primeiras posições alterada (base muda, DV não confere mais)", () => {
    expect(validarCnpj("PC3D315K000293")).toBe(false);
  });

  it("rejeita CNPJ com letra nas 2 últimas posições — dígitos verificadores são sempre numéricos", () => {
    expect(validarCnpj("PC3D315K00019A")).toBe(false);
  });
});
