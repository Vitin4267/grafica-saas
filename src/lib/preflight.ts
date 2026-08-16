// Preflight automático de arquivo de arte — roda no momento do upload (ver
// enviarArte em src/app/producao/actions.ts e enviarArteOrcamento em
// src/app/orcamento/[id]/actions.ts), nunca bloqueia o upload: é melhor
// esforço, puramente informativo pra gráfica decidir se pede um arquivo
// melhor antes de mandar pra impressão. Resultado grava em
// Orcamento.preflightAvisos / Pedido.preflightAvisos (ver comentário desses
// campos no schema.prisma pra contexto de como cada um é preenchido/copiado).
//
// v1 cobre só o que foi validado por spike técnico real (ver histórico da
// tarefa): DPI efetivo + espaço de cor pra imagem raster (via sharp), e
// sangria estimada por MediaBox×TrimBox pra PDF (via pdf-lib, API de baixo
// nível — TrimBox não tem getter que distingue "ausente" de "igual ao
// MediaBox", só o node cru dá isso). NÃO tenta detectar CMYK/RGB dentro do
// conteúdo de um PDF já pronto — não é confiável com essas bibliotecas.
import sharp from "sharp";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";

export type AvisoPreflight = {
  checagem: "dpi_baixo" | "espaco_cor" | "sem_sangria";
  severidade: "aviso" | "info";
  mensagem: string;
};

type ItemPreflight = { larguraCm: number | null; alturaCm: number | null };

const DPI_MINIMO = 150;
// 1pt = 1/72in = 0.3528mm — usado pra converter a diferença MediaBox×TrimBox
// (sempre em pontos PDF) pra milímetros, a unidade que a gráfica entende.
const PT_PARA_MM = 0.3528;
const MARGEM_MINIMA_SANGRIA_MM = 2;

const TIPOS_RASTER = new Set(["image/jpeg", "image/png", "image/webp"]);

// O maior item é o mais exigente pra DPI: se a resolução é suficiente pro
// maior, é suficiente pros menores também. Ignora item SIMPLES sem medida
// (larguraCm/alturaCm null) — não entra na disputa por "maior área".
function encontrarMaiorItem(itens: ItemPreflight[]): { larguraCm: number; alturaCm: number } | null {
  let maior: { larguraCm: number; alturaCm: number } | null = null;
  for (const item of itens) {
    if (item.larguraCm == null || item.alturaCm == null) continue;
    if (item.larguraCm <= 0 || item.alturaCm <= 0) continue;
    const area = item.larguraCm * item.alturaCm;
    if (!maior || area > maior.larguraCm * maior.alturaCm) {
      maior = { larguraCm: item.larguraCm, alturaCm: item.alturaCm };
    }
  }
  return maior;
}

async function analisarRaster(buffer: Buffer, itens: ItemPreflight[]): Promise<AvisoPreflight[]> {
  const avisos: AvisoPreflight[] = [];
  const metadata = await sharp(buffer).metadata();

  const maiorItem = encontrarMaiorItem(itens);
  if (maiorItem && metadata.width && metadata.height) {
    // density (DPI embutido no arquivo) NÃO é usado de propósito — é um
    // metadado quase sempre ausente ou um default sem sentido (72), que não
    // reflete o tamanho físico real em que a arte vai ser impressa. O único
    // DPI que importa é o calculado contra o tamanho do item.
    const dpiHorizontal = metadata.width / (maiorItem.larguraCm / 2.54);
    const dpiVertical = metadata.height / (maiorItem.alturaCm / 2.54);
    // O lado mais "esticado" (menor DPI) é o que decide — não adianta um
    // lado com folga se o outro já sai pixelado.
    const dpiEfetivo = Math.min(dpiHorizontal, dpiVertical);
    if (dpiEfetivo < DPI_MINIMO) {
      avisos.push({
        checagem: "dpi_baixo",
        severidade: "aviso",
        mensagem:
          "Resolução baixa — a imagem pode sair pixelada no tamanho impresso. Recomendado: pelo menos 150 DPI.",
      });
    }
  }

  // RGB não é erro — depende do processo de impressão da gráfica (offset
  // exige CMYK, mas digital muitas vezes imprime RGB direto) — por isso é
  // sempre "info", nunca "aviso".
  if (metadata.space && metadata.space !== "cmyk") {
    avisos.push({
      checagem: "espaco_cor",
      severidade: "info",
      mensagem: "Arquivo está em RGB — se a impressão for offset/CMYK, confirme com a gráfica se precisa converter.",
    });
  }

  return avisos;
}

async function analisarPdf(buffer: Buffer): Promise<AvisoPreflight[]> {
  const avisos: AvisoPreflight[] = [];
  const pdf = await PDFDocument.load(buffer);
  const pagina = pdf.getPage(0);

  // TrimBox é OPCIONAL — a maioria dos PDFs simples (Canva, Word etc.) nunca
  // define, e isso é normal, NÃO significa "sem sangria". Por isso usamos o
  // node de baixo nível: page.getTrimBox() (alto nível) cai de volta pro
  // CropBox/MediaBox quando ausente, o que criaria um falso positivo (diff
  // zero pareceria "sangria insuficiente"). Só olhamos pra este achado
  // quando o PDF de fato declarou um TrimBox próprio.
  //
  // Chamado SEM o segundo argumento de tipo de propósito: lookup(key, Tipo)
  // lança UnexpectedObjectTypeError quando a chave não existe (só o overload
  // sem tipo devolve undefined em silêncio) — ver PDFContext.lookup.
  const trimBoxObjeto = pagina.node.lookup(PDFName.of("TrimBox"));
  const trimBoxArray = trimBoxObjeto instanceof PDFArray ? trimBoxObjeto : null;
  if (trimBoxArray) {
    const mediaBox = pagina.getMediaBox();
    const trimBox = trimBoxArray.asRectangle();

    const margemEsquerda = trimBox.x - mediaBox.x;
    const margemInferior = trimBox.y - mediaBox.y;
    const margemDireita = mediaBox.x + mediaBox.width - (trimBox.x + trimBox.width);
    const margemSuperior = mediaBox.y + mediaBox.height - (trimBox.y + trimBox.height);
    const menorMargemPt = Math.min(margemEsquerda, margemInferior, margemDireita, margemSuperior);
    const menorMargemMm = menorMargemPt * PT_PARA_MM;

    if (menorMargemMm < MARGEM_MINIMA_SANGRIA_MM) {
      avisos.push({
        checagem: "sem_sangria",
        severidade: "aviso",
        mensagem:
          "O arquivo pode não ter sangria suficiente — a margem entre a arte e a linha de corte é menor que 2mm. Recomendado pelo menos 2-3mm de sangria em cada lado pra evitar borda branca depois do corte.",
      });
    }
  }

  return avisos;
}

export async function analisarPreflight(
  buffer: Buffer,
  mimeType: string,
  itens: ItemPreflight[]
): Promise<AvisoPreflight[]> {
  try {
    if (TIPOS_RASTER.has(mimeType)) {
      return await analisarRaster(buffer, itens);
    }
    if (mimeType === "application/pdf") {
      return await analisarPdf(buffer);
    }
    return [];
  } catch (erro) {
    // Melhor esforço — preflight é um recurso a mais, nunca uma validação
    // bloqueante. Um PDF corrompido ou imagem que o sharp não consegue ler
    // não pode derrubar o upload, só resulta em "sem achados".
    console.error("[analisarPreflight] falha ao analisar arquivo de arte", { mimeType }, erro);
    return [];
  }
}
