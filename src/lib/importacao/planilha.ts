import "server-only";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { ehPlanilhaXlsx } from "@/lib/upload-validacao";

// Parsing de planilha pro Importador com IA — determinístico, sem IA
// envolvida (a IA só sugere MAPEAMENTO de coluna, ver webhook-importacao.ts;
// a leitura de dado bruto é sempre código puro). Usa `exceljs` (não `xlsx`/
// SheetJS: a versão publicada no npm tem vulnerabilidade de alta
// severidade sem correção disponível — ver GHSA-4r6h-8v6p-xvw6).

export const MAX_LINHAS_PLANILHA = 1500;
export const MAX_COLUNAS_PLANILHA = 40;
const AMOSTRA_LINHAS_IA = 8;
const AMOSTRA_CELULA_MAX_CHARS = 200;

export type PlanilhaParseada = { cabecalhos: string[]; linhas: string[][] }; // linhas paralelas a cabecalhos, tudo string
export type ResultadoParsePlanilha = { ok: true; dados: PlanilhaParseada } | { ok: false; mensagem: string };

// exceljs devolve tipos bem diferentes por célula (número, Date, fórmula
// {formula,result}, hyperlink {text,hyperlink}, rich text {richText:[...]}).
// Normaliza tudo pro texto que a pessoa VÊ na célula — mesmo texto que a UI
// de confirmação de mapeamento mostra; número/data são reconvertidos depois,
// por campo, na escrita (ver parseNumeroBrasileiro/parseDataBrasileira).
function celulaParaTexto(valor: ExcelJS.CellValue): string {
  if (valor == null) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "object") {
    if ("result" in valor) return celulaParaTexto(valor.result as ExcelJS.CellValue);
    if ("text" in valor && typeof valor.text === "string") return valor.text;
    if ("richText" in valor && Array.isArray(valor.richText)) {
      return valor.richText.map((parte) => parte.text).join("");
    }
    return "";
  }
  return String(valor).trim();
}

export async function parsePlanilha(buffer: Buffer, nomeArquivo: string): Promise<ResultadoParsePlanilha> {
  const workbook = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet | undefined;
  try {
    if (ehPlanilhaXlsx(nomeArquivo)) {
      // exceljs declara seu PRÓPRIO tipo local "Buffer" (extends ArrayBuffer,
      // sem os métodos reais do Buffer do Node) dentro do próprio .d.ts —
      // sombreia o Buffer real do @types/node só ali dentro (bug de tipagem
      // conhecido da lib; em runtime é sempre um Buffer do Node de verdade).
      // Cast estreito só nesta borda, via Parameters<> pra não depender de
      // nomear o tipo deles.
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      sheet = workbook.worksheets[0];
    } else {
      // Readable.from(buffer) (sem array) iteraria BYTE A BYTE (Buffer é
      // iterável) — teria que envolver num array de 1 item pra sair como um
      // chunk só, senão o parser de CSV recebe número em vez de texto.
      sheet = await workbook.csv.read(Readable.from([buffer]));
    }
  } catch {
    return { ok: false, mensagem: "Não consegui ler esse arquivo — confira se é .xlsx ou .csv válido." };
  }

  if (!sheet || sheet.rowCount < 2) {
    return { ok: false, mensagem: "A planilha precisa ter um cabeçalho e pelo menos uma linha de dados." };
  }

  const totalLinhasDados = sheet.rowCount - 1;
  if (totalLinhasDados > MAX_LINHAS_PLANILHA) {
    return {
      ok: false,
      mensagem: `Essa planilha tem ${totalLinhasDados} linhas — o limite por importação é ${MAX_LINHAS_PLANILHA}. Divida em arquivos menores.`,
    };
  }

  const linhaCabecalho = sheet.getRow(1);
  const totalColunas = Math.min(linhaCabecalho.cellCount, MAX_COLUNAS_PLANILHA);
  const cabecalhos: string[] = [];
  for (let c = 1; c <= totalColunas; c++) {
    cabecalhos.push(celulaParaTexto(linhaCabecalho.getCell(c).value));
  }

  const linhas: string[][] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const linhaExcel = sheet.getRow(r);
    if (linhaExcel.cellCount === 0) continue; // linha totalmente vazia no fim do arquivo
    const linha: string[] = [];
    let temAlgumValor = false;
    for (let c = 1; c <= totalColunas; c++) {
      const texto = celulaParaTexto(linhaExcel.getCell(c).value);
      if (texto) temAlgumValor = true;
      linha.push(texto);
    }
    if (temAlgumValor) linhas.push(linha);
  }

  if (linhas.length === 0) {
    return { ok: false, mensagem: "A planilha precisa ter um cabeçalho e pelo menos uma linha de dados." };
  }

  return { ok: true, dados: { cabecalhos, linhas } };
}

// Trunca célula por célula ANTES de mandar pro webhook — nunca confia no
// tamanho do arquivo original (proteção de payload/custo; não presente em
// webhook-tinta.ts porque lá só uma URL assinada é enviada, não dado bruto).
export function amostraParaIA(dados: PlanilhaParseada): string[][] {
  return dados.linhas
    .slice(0, AMOSTRA_LINHAS_IA)
    .map((linha) => linha.map((v) => v.slice(0, AMOSTRA_CELULA_MAX_CHARS)));
}

// "1.234,56" ou "R$ 1.234,56" ou "1234.56" → 1234.56. null = não deu pra
// interpretar como número (chamador decide se isso é erro ou "vazio").
export function parseNumeroBrasileiro(valor: string): number | null {
  const limpo = valor.trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  // Vírgula seguida de 1-2 dígitos no final = separador decimal BR
  // ("1.234,56"). Sem isso, assume formato já normalizado ("1234.56") e só
  // remove vírgula de milhar.
  const comVirgulaDecimal = /,\d{1,2}$/.test(limpo);
  const normalizado = comVirgulaDecimal ? limpo.replace(/\./g, "").replace(",", ".") : limpo.replace(/,/g, "");
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

// "15/03/2026", "15/03/26" (BR) ou "2026-03-15" (ISO, já normalizado por
// dataInputParaUTC noutro lugar do app) → Date em meia-noite UTC, mesmo
// padrão de src/lib/data.ts. null = formato não reconhecido.
export function parseDataBrasileira(valor: string): Date | null {
  const v = valor.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (isoMatch) {
    const data = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00Z`);
    return Number.isNaN(data.getTime()) ? null : data;
  }
  const brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(v);
  if (brMatch) {
    const [, d, m, yRaw] = brMatch;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    const dia = d.padStart(2, "0");
    const mes = m.padStart(2, "0");
    const data = new Date(`${y}-${mes}-${dia}T00:00:00Z`);
    return Number.isNaN(data.getTime()) ? null : data;
  }
  return null;
}

// Reconstrói uma linha como { campoDeSistema: valorCru } a partir do
// mapeamento coluna→campo confirmado — "ignorar" (ou coluna sem mapeamento)
// nunca entra no resultado.
export function aplicarMapeamento(
  cabecalhos: string[],
  linha: string[],
  mapeamento: Record<string, string>
): Record<string, string> {
  const resultado: Record<string, string> = {};
  cabecalhos.forEach((cabecalho, i) => {
    const campo = mapeamento[cabecalho];
    if (campo && campo !== "ignorar") resultado[campo] = linha[i] ?? "";
  });
  return resultado;
}
