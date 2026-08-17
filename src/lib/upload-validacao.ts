// Validação pura de upload (tipo/tamanho), compartilhada entre enviarArte
// (src/app/producao/actions.ts) e salvarLogo (src/app/configuracoes/identidade/actions.ts)
// — extraída pra ser testável sem precisar simular um File/Blob de verdade
// nem tocar o Vercel Blob.
export type ValidacaoArquivo = { ok: true } | { ok: false; mensagem: string };

const TIPOS_ARTE_PERMITIDOS = new Set(["application/pdf", "image/jpeg", "image/png"]);
// 20MB estava rejeitando arte de verdade (proof/scan multi-página em alta
// resolução) — subido pra 30MB. Se ainda barrar arquivo legítimo, o próximo
// passo é rever de novo (ver next.config.ts serverActions.bodySizeLimit, que
// precisa continuar folgado acima deste valor).
const TAMANHO_MAXIMO_ARTE = 30 * 1024 * 1024;

export function validarArquivoArte(arquivo: { type: string; size: number }): ValidacaoArquivo {
  if (arquivo.size === 0) return { ok: false, mensagem: "Selecione um arquivo." };
  if (!TIPOS_ARTE_PERMITIDOS.has(arquivo.type)) {
    return { ok: false, mensagem: "Envie um arquivo PDF, JPG ou PNG." };
  }
  if (arquivo.size > TAMANHO_MAXIMO_ARTE) {
    return { ok: false, mensagem: "Arquivo muito grande — o limite é 30MB." };
  }
  return { ok: true };
}

export function extensaoArte(tipo: string): "pdf" | "png" | "jpg" {
  if (tipo === "application/pdf") return "pdf";
  if (tipo === "image/png") return "png";
  return "jpg";
}

// PNG/JPEG/WEBP só — sem SVG de propósito: um SVG pode carregar script
// embutido, e a logo acaba renderizada como <img>/Image tanto no PDF quanto
// em qualquer tela pública, então nunca deve virar HTML interpretado.
const TIPOS_LOGO_PERMITIDOS = new Set(["image/png", "image/jpeg", "image/webp"]);
const TAMANHO_MAXIMO_LOGO = 3 * 1024 * 1024;

export function validarArquivoLogo(arquivo: { type: string; size: number }): ValidacaoArquivo {
  if (arquivo.size === 0) return { ok: false, mensagem: "Selecione uma imagem." };
  if (!TIPOS_LOGO_PERMITIDOS.has(arquivo.type)) {
    return { ok: false, mensagem: "Envie uma imagem PNG, JPG ou WEBP." };
  }
  if (arquivo.size > TAMANHO_MAXIMO_LOGO) {
    return { ok: false, mensagem: "Imagem muito grande — o limite é 3MB." };
  }
  return { ok: true };
}

export function extensaoLogo(tipo: string): "png" | "webp" | "jpg" {
  if (tipo === "image/png") return "png";
  if (tipo === "image/webp") return "webp";
  return "jpg";
}

// Imagem de análise de tinta com IA (Cálculo de gasto de tinta) — regras
// próprias, não as de arte: SEM PDF (o modelo de visão come raster; PDF
// exigiria rasterizar dentro do n8n) e SEM SVG (mesma razão de
// TIPOS_LOGO_PERMITIDOS, script embutido). 8MB, não 30MB: o upload acontece
// dentro da mesma Server Action que espera a IA (precisa caber no orçamento
// de tempo), e um modelo de visão reescala a imagem de qualquer jeito — 8MB
// já é folga enorme.
const TIPOS_IMAGEM_TINTA_PERMITIDOS = new Set(["image/png", "image/jpeg", "image/webp"]);
const TAMANHO_MAXIMO_IMAGEM_TINTA = 8 * 1024 * 1024;

export function validarArquivoImagemTinta(arquivo: { type: string; size: number }): ValidacaoArquivo {
  if (arquivo.size === 0) return { ok: false, mensagem: "Selecione uma imagem." };
  if (!TIPOS_IMAGEM_TINTA_PERMITIDOS.has(arquivo.type)) {
    return { ok: false, mensagem: "Envie uma imagem PNG, JPG ou WEBP." };
  }
  if (arquivo.size > TAMANHO_MAXIMO_IMAGEM_TINTA) {
    return { ok: false, mensagem: "Imagem muito grande — o limite é 8MB." };
  }
  return { ok: true };
}

export function extensaoImagemTinta(tipo: string): "png" | "webp" | "jpg" {
  if (tipo === "image/png") return "png";
  if (tipo === "image/webp") return "webp";
  return "jpg";
}

// Planilha do Importador com IA (src/app/importar) — vai pro store PRIVADO
// (nunca vira URL pública), então a preocupação de "hospedar arquivo
// malicioso numa URL de boa reputação" (ver comentário grande abaixo) não
// se aplica aqui como se aplica pra arte/logo. Mesmo assim vale limitar
// tamanho/tipo antes de gastar tempo de parser em algo que não é planilha.
const TIPOS_PLANILHA_PERMITIDOS = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel", // alguns navegadores/SOs relatam .csv assim
  "", // navegador às vezes não declara tipo nenhum pra .csv — extensão decide
]);
const EXTENSOES_PLANILHA_PERMITIDAS = [".xlsx", ".csv"];
const TAMANHO_MAXIMO_PLANILHA = 10 * 1024 * 1024;

export function validarArquivoPlanilha(arquivo: { type: string; size: number; name: string }): ValidacaoArquivo {
  if (arquivo.size === 0) return { ok: false, mensagem: "Selecione um arquivo." };
  const nomeMinusculo = arquivo.name.toLowerCase();
  const extensaoOk = EXTENSOES_PLANILHA_PERMITIDAS.some((ext) => nomeMinusculo.endsWith(ext));
  if (!extensaoOk || !TIPOS_PLANILHA_PERMITIDOS.has(arquivo.type)) {
    return { ok: false, mensagem: "Envie um arquivo .xlsx ou .csv." };
  }
  if (arquivo.size > TAMANHO_MAXIMO_PLANILHA) {
    return { ok: false, mensagem: "Arquivo muito grande — o limite é 10MB." };
  }
  return { ok: true };
}

export function ehPlanilhaXlsx(nomeArquivo: string): boolean {
  return nomeArquivo.toLowerCase().endsWith(".xlsx");
}

// Assinatura ("magic bytes") de cada formato aceito. As validações acima
// checam `arquivo.type`, que é o Content-Type DECLARADO pelo cliente no
// multipart — trivialmente forjável montando a requisição à mão. Sem conferir
// o conteúdo real, qualquer arquivo podia ser hospedado numa URL pública e
// permanente de um domínio da Vercel (boa reputação, passa por filtro
// corporativo e antivírus de gateway), faturado na conta do dono do produto.
//
// Recebe Uint8Array (não File) de propósito, pra este módulo continuar puro e
// testável sem simular Blob — quem chama lê os primeiros bytes e passa aqui.
// 12 bytes bastam pra todos os formatos abaixo (WEBP é o mais longo: RIFF +
// 4 bytes de tamanho + WEBP).
export const BYTES_ASSINATURA = 12;

function comecaCom(bytes: Uint8Array, assinatura: number[]): boolean {
  if (bytes.length < assinatura.length) return false;
  return assinatura.every((byte, i) => bytes[i] === byte);
}

export function assinaturaBateComTipo(bytes: Uint8Array, tipo: string): boolean {
  switch (tipo) {
    case "application/pdf":
      return comecaCom(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case "image/png":
      return comecaCom(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return comecaCom(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      // RIFF....WEBP — os 4 bytes do meio são o tamanho do arquivo, variam.
      return (
        comecaCom(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes.length >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      // .xlsx é um ZIP — assinatura padrão de arquivo ZIP local (PK\x03\x04).
      return comecaCom(bytes, [0x50, 0x4b, 0x03, 0x04]);
    default:
      // Tipo fora das allowlists acima nunca chega aqui (as validações de
      // tipo rodam antes), mas fail-closed por garantia.
      return false;
  }
}
