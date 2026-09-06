// Achado F4 da auditoria de abrangência (Parte 7, 2026-09-05): certificação
// de cadeia de custódia da matéria-prima (FSC/PEFC de papel, principalmente)
// — exigível em gráfica/rotulador que atende cliente com política de
// sustentabilidade, com código de licença exibido na peça impressa. Mesmo
// padrão fechado+OUTRO já usado por acabamento-estrutural.ts (lista fechada
// + rótulo em pt-BR), referenciado direto por ItemGrafica.certificacao.
//
// IMPORTANTE: puramente descritivo/organizacional. NUNCA importar isto (nem
// os campos certificacao/certificacaoOutro de ItemGrafica) de dentro de
// src/lib/pricing/ — não participa de nenhum cálculo de custo/preço.

export type CertificacaoMaterial = "FSC" | "PEFC" | "NENHUMA" | "OUTRO";

export const CERTIFICACOES_MATERIAL: CertificacaoMaterial[] = ["FSC", "PEFC", "NENHUMA", "OUTRO"];

export const ROTULO_CERTIFICACAO_MATERIAL: Record<CertificacaoMaterial, string> = {
  FSC: "FSC (Forest Stewardship Council)",
  PEFC: "PEFC (Programme for the Endorsement of Forest Certification)",
  NENHUMA: "Nenhuma",
  OUTRO: "Outro",
};

// Mesma resolução de rótulo de rotuloTipoDobra (src/lib/acabamento-estrutural.ts):
// se a certificação escolhida = OUTRO, usa o texto livre; senão usa o rótulo fixo.
export function rotuloCertificacaoMaterial(
  certificacao: string | null | undefined,
  outro?: string | null
): string {
  if (!certificacao) return "";
  if (certificacao === "OUTRO") return outro?.trim() || ROTULO_CERTIFICACAO_MATERIAL.OUTRO;
  return ROTULO_CERTIFICACAO_MATERIAL[certificacao as CertificacaoMaterial] ?? certificacao;
}
