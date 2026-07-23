import { describe, it, expect } from "vitest";
import { linhaCsv } from "./csv";

describe("linhaCsv", () => {
  it("monta uma linha normal entre aspas separada por ;", () => {
    expect(linhaCsv(["Data", "Cliente", "Valor"])).toBe('"Data";"Cliente";"Valor"\r\n');
  });

  it("escapa aspas duplas dentro do valor", () => {
    expect(linhaCsv(['Cliente "VIP"'])).toBe('"Cliente ""VIP"""\r\n');
  });

  // Achado da auditoria de 2026-07-23: célula começando com =, +, -, @ ou tab
  // é interpretada como fórmula pelo Excel/Sheets — um nome de cliente
  // malicioso podia executar/vazar dado quando o DONO abrisse o CSV.
  it("neutraliza célula começando com = (CSV/Formula Injection)", () => {
    expect(linhaCsv(["=cmd|'/c calc'!A1"])).toBe("\"'=cmd|'/c calc'!A1\"\r\n");
  });

  it("neutraliza célula começando com +", () => {
    expect(linhaCsv(["+1+1"])).toBe('"\'+1+1"\r\n');
  });

  it("neutraliza célula começando com @", () => {
    expect(linhaCsv(["@SUM(A1)"])).toBe('"\'@SUM(A1)"\r\n');
  });

  it("neutraliza célula começando com tab", () => {
    expect(linhaCsv(["\t=1+1"])).toBe('"\'\t=1+1"\r\n');
  });

  it("não mexe num valor de texto normal que só contém = no meio", () => {
    expect(linhaCsv(["Fórmula = preço x quantidade"])).toBe('"Fórmula = preço x quantidade"\r\n');
  });

  it("não sanitiza number negativo formatado pela própria app (não é texto de usuário)", () => {
    expect(linhaCsv([-5])).toBe('"-5"\r\n');
  });
});
