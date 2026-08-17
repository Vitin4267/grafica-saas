import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  parsePlanilha,
  amostraParaIA,
  parseNumeroBrasileiro,
  parseDataBrasileira,
  aplicarMapeamento,
  MAX_LINHAS_PLANILHA,
} from "./planilha";

async function bufferXlsx(linhas: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Planilha1");
  linhas.forEach((linha) => sheet.addRow(linha));
  // ver comentário em planilha.ts sobre o tipo Buffer local (quebrado) do
  // próprio .d.ts do exceljs — cast duplo via unknown, mesma borda.
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

describe("parsePlanilha", () => {
  it("lê um .xlsx com cabeçalho e linhas de dados", async () => {
    const buffer = await bufferXlsx([
      ["Nome", "Email"],
      ["Fulano", "fulano@teste.com"],
      ["Beltrano", "beltrano@teste.com"],
    ]);
    const resultado = await parsePlanilha(buffer, "clientes.xlsx");
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.cabecalhos).toEqual(["Nome", "Email"]);
      expect(resultado.dados.linhas).toEqual([
        ["Fulano", "fulano@teste.com"],
        ["Beltrano", "beltrano@teste.com"],
      ]);
    }
  });

  it("lê um .csv (mesma API, arquivo com extensão diferente)", async () => {
    const csv = "Nome,Email,Preco\nFulano,fulano@teste.com,\"1.234,56\"\n";
    const buffer = Buffer.from(csv, "utf-8");
    const resultado = await parsePlanilha(buffer, "catalogo.csv");
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.cabecalhos).toEqual(["Nome", "Email", "Preco"]);
      expect(resultado.dados.linhas).toEqual([["Fulano", "fulano@teste.com", "1.234,56"]]);
    }
  });

  it("rejeita arquivo sem linha de dado (só cabeçalho)", async () => {
    const buffer = await bufferXlsx([["Nome", "Email"]]);
    const resultado = await parsePlanilha(buffer, "vazio.xlsx");
    expect(resultado.ok).toBe(false);
  });

  it("rejeita arquivo corrompido/ilegível", async () => {
    const resultado = await parsePlanilha(Buffer.from("isso não é uma planilha"), "quebrado.xlsx");
    expect(resultado.ok).toBe(false);
  });

  it("pula linha totalmente vazia no meio/fim do arquivo", async () => {
    const buffer = await bufferXlsx([
      ["Nome", "Email"],
      ["Fulano", "fulano@teste.com"],
      ["", ""],
    ]);
    const resultado = await parsePlanilha(buffer, "com-linha-vazia.xlsx");
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.linhas).toHaveLength(1);
  });

  it("rejeita planilha acima do limite de linhas", async () => {
    const linhas: string[][] = [["Nome"]];
    for (let i = 0; i < MAX_LINHAS_PLANILHA + 1; i++) linhas.push([`Cliente ${i}`]);
    const buffer = await bufferXlsx(linhas);
    const resultado = await parsePlanilha(buffer, "grande.xlsx");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.mensagem).toMatch(/limite/);
  });
});

describe("amostraParaIA", () => {
  it("corta pra no máximo 8 linhas e trunca célula grande", () => {
    const linhas = Array.from({ length: 20 }, (_, i) => [`linha${i}`]);
    const dados = { cabecalhos: ["Col"], linhas };
    expect(amostraParaIA(dados)).toHaveLength(8);

    const celulaGrande = "a".repeat(500);
    const amostra = amostraParaIA({ cabecalhos: ["Col"], linhas: [[celulaGrande]] });
    expect(amostra[0][0]).toHaveLength(200);
  });
});

describe("parseNumeroBrasileiro", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["R$ 1.234,56", 1234.56],
    ["12,90", 12.9],
    ["1234.56", 1234.56],
    ["99", 99],
    ["", null],
    ["abc", null],
  ])("%s -> %s", (entrada, esperado) => {
    expect(parseNumeroBrasileiro(entrada)).toBe(esperado);
  });
});

describe("parseDataBrasileira", () => {
  it("aceita DD/MM/AAAA", () => {
    const data = parseDataBrasileira("15/03/2026");
    expect(data?.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("aceita DD/MM/AA (2 dígitos, assume 20XX)", () => {
    const data = parseDataBrasileira("15/03/26");
    expect(data?.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("aceita AAAA-MM-DD (ISO já normalizado)", () => {
    const data = parseDataBrasileira("2026-03-15");
    expect(data?.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("null pra formato não reconhecido", () => {
    expect(parseDataBrasileira("15 de março")).toBeNull();
    expect(parseDataBrasileira("")).toBeNull();
  });
});

describe("aplicarMapeamento", () => {
  it("mapeia colunas pro campo confirmado, ignorando 'ignorar' e coluna sem mapeamento", () => {
    const resultado = aplicarMapeamento(
      ["Nome", "Lixo", "E-mail"],
      ["Fulano", "descarta", "fulano@teste.com"],
      { Nome: "nome", Lixo: "ignorar", "E-mail": "email" }
    );
    expect(resultado).toEqual({ nome: "Fulano", email: "fulano@teste.com" });
  });

  it("coluna sem entrada no mapeamento também é ignorada", () => {
    const resultado = aplicarMapeamento(["Nome", "Extra"], ["Fulano", "x"], { Nome: "nome" });
    expect(resultado).toEqual({ nome: "Fulano" });
  });
});
