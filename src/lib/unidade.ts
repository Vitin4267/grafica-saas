export const ROTULO_UNIDADE: Record<string, string> = {
  FOLHA: "folha",
  METRO_QUADRADO: "m²",
  METRO_LINEAR: "m linear",
  UNIDADE: "unidade",
  LITRO: "litro",
  KG: "kg",
  ROLO: "rolo",
  PACOTE: "pacote",
  CENTO: "cento",
  MILHEIRO: "milheiro",
  HORA: "hora",
  // Rótulo genérico — o texto de verdade de um item unidade=OUTRO vem do
  // campo livre ItemCatalogo.unidadeOutro (ver rotuloUnidade abaixo), nunca
  // deste mapa. Só existe aqui pra a opção aparecer no <Select> de cadastro
  // e como fallback caso unidadeOutro esteja vazio por algum motivo.
  OUTRO: "outro",
};

// Rótulo de exibição de uma unidade de medida, resolvendo o caso especial
// unidade=OUTRO pro texto livre cadastrado (unidadeOutro) em vez do rótulo
// genérico do mapa acima — usado em toda tela que mostra a unidade de um
// ItemCatalogo (catálogo, ficha técnica, configuração avançada do item).
export function rotuloUnidade(
  unidade: string | null | undefined,
  unidadeOutro?: string | null
): string {
  if (!unidade) return "";
  if (unidade === "OUTRO") return unidadeOutro?.trim() || ROTULO_UNIDADE.OUTRO;
  return ROTULO_UNIDADE[unidade] ?? unidade;
}
