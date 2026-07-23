// Validação pura de upload (tipo/tamanho), compartilhada entre enviarArte
// (src/app/producao/actions.ts) e salvarLogo (src/app/configuracoes/identidade/actions.ts)
// — extraída pra ser testável sem precisar simular um File/Blob de verdade
// nem tocar o Vercel Blob.
export type ValidacaoArquivo = { ok: true } | { ok: false; mensagem: string };

const TIPOS_ARTE_PERMITIDOS = new Set(["application/pdf", "image/jpeg", "image/png"]);
const TAMANHO_MAXIMO_ARTE = 20 * 1024 * 1024;

export function validarArquivoArte(arquivo: { type: string; size: number }): ValidacaoArquivo {
  if (arquivo.size === 0) return { ok: false, mensagem: "Selecione um arquivo." };
  if (!TIPOS_ARTE_PERMITIDOS.has(arquivo.type)) {
    return { ok: false, mensagem: "Envie um arquivo PDF, JPG ou PNG." };
  }
  if (arquivo.size > TAMANHO_MAXIMO_ARTE) {
    return { ok: false, mensagem: "Arquivo muito grande — o limite é 20MB." };
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
