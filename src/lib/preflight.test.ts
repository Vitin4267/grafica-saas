import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { analisarPreflight } from "./preflight";

// Item de 10cm x 10cm — usado nos casos de DPI abaixo. Escolhido pra deixar
// a conta redonda: 10cm = 3.937... polegadas.
const ITEM_10X10 = [{ larguraCm: 10, alturaCm: 10 }];

async function pngComPixels(largura: number, altura: number): Promise<Buffer> {
  return sharp({
    create: {
      width: largura,
      height: altura,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

describe("analisarPreflight — imagem raster", () => {
  it("gera aviso de dpi_baixo quando a imagem é pequena demais pro tamanho do item", async () => {
    // 100x100px num item de 10x10cm = ~254 DPI... queremos ficar ABAIXO de
    // 150, então usamos uma imagem bem pequena: 200px pra 10cm ainda dá ~50
    // DPI, bem abaixo do limite.
    const buffer = await pngComPixels(200, 200);
    const avisos = await analisarPreflight(buffer, "image/png", ITEM_10X10);

    const avisoDpi = avisos.find((a) => a.checagem === "dpi_baixo");
    expect(avisoDpi).toBeDefined();
    expect(avisoDpi?.severidade).toBe("aviso");
  });

  it("não gera aviso de dpi_baixo quando a resolução é suficiente pro tamanho do item", async () => {
    // 10cm = 3.937in — 1200px nessa medida dá ~305 DPI, bem acima de 150.
    const buffer = await pngComPixels(1200, 1200);
    const avisos = await analisarPreflight(buffer, "image/png", ITEM_10X10);

    expect(avisos.find((a) => a.checagem === "dpi_baixo")).toBeUndefined();
  });

  it("pula a checagem de DPI quando nenhum item tem largura/altura (item SIMPLES)", async () => {
    const buffer = await pngComPixels(50, 50);
    const avisos = await analisarPreflight(buffer, "image/png", [{ larguraCm: null, alturaCm: null }]);

    expect(avisos.find((a) => a.checagem === "dpi_baixo")).toBeUndefined();
  });

  it("gera achado informativo de espaco_cor quando a imagem está em RGB", async () => {
    const buffer = await pngComPixels(1200, 1200);
    const avisos = await analisarPreflight(buffer, "image/png", ITEM_10X10);

    const avisoCor = avisos.find((a) => a.checagem === "espaco_cor");
    expect(avisoCor).toBeDefined();
    expect(avisoCor?.severidade).toBe("info");
  });

  it("usa o item de maior área quando há mais de um item no orçamento/pedido", async () => {
    // Item pequeno (2x2cm) teria DPI ótimo com 200px; item grande (50x50cm)
    // com os mesmos 200px fica bem abaixo de 150 DPI — a checagem deve usar
    // o maior (50x50), então tem que gerar aviso.
    const buffer = await pngComPixels(200, 200);
    const avisos = await analisarPreflight(buffer, "image/png", [
      { larguraCm: 2, alturaCm: 2 },
      { larguraCm: 50, alturaCm: 50 },
    ]);

    expect(avisos.find((a) => a.checagem === "dpi_baixo")).toBeDefined();
  });
});

describe("analisarPreflight — PDF", () => {
  it("não gera achado de sem_sangria quando o PDF não define TrimBox (comportamento normal, não é falso positivo)", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 300]); // só MediaBox, sem TrimBox — igual PDF exportado de Canva/Word
    const buffer = Buffer.from(await pdf.save());

    const avisos = await analisarPreflight(buffer, "application/pdf", []);
    expect(avisos.find((a) => a.checagem === "sem_sangria")).toBeUndefined();
  });

  it("gera aviso de sem_sangria quando o TrimBox existe e está muito próximo do MediaBox", async () => {
    const pdf = await PDFDocument.create();
    const pagina = pdf.addPage([300, 300]);
    // Margem de 1pt (~0.35mm) de cada lado — bem abaixo do limite de 2mm.
    pagina.setTrimBox(1, 1, 298, 298);
    const buffer = Buffer.from(await pdf.save());

    const avisos = await analisarPreflight(buffer, "application/pdf", []);
    const avisoSangria = avisos.find((a) => a.checagem === "sem_sangria");
    expect(avisoSangria).toBeDefined();
    expect(avisoSangria?.severidade).toBe("aviso");
  });

  it("não gera aviso de sem_sangria quando o TrimBox tem margem confortável", async () => {
    const pdf = await PDFDocument.create();
    const pagina = pdf.addPage([300, 300]);
    // ~8.5mm de margem de cada lado (24pt) — bem acima do limite de 2mm.
    pagina.setTrimBox(24, 24, 252, 252);
    const buffer = Buffer.from(await pdf.save());

    const avisos = await analisarPreflight(buffer, "application/pdf", []);
    expect(avisos.find((a) => a.checagem === "sem_sangria")).toBeUndefined();
  });
});

describe("analisarPreflight — arquivo inválido (melhor esforço)", () => {
  it("devolve array vazio (não lança) quando o buffer não é um arquivo válido pro tipo declarado", async () => {
    const buffer = Buffer.from("isso não é nem imagem nem PDF de verdade");
    const avisos = await analisarPreflight(buffer, "image/png", ITEM_10X10);
    expect(avisos).toEqual([]);
  });

  it("devolve array vazio pra um mimeType não suportado", async () => {
    const buffer = Buffer.from("qualquer coisa");
    const avisos = await analisarPreflight(buffer, "application/octet-stream", ITEM_10X10);
    expect(avisos).toEqual([]);
  });
});
