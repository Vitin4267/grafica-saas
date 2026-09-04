// Achado C5 da auditoria de abrangência (Parte 7, 2026-09-04): os únicos
// enums estruturados de acabamento (TipoAdesivo/TipoSerrilha/TipoLaminacao/
// TipoAcabamentoVerniz/TipoHotStamping) só existiam em OrcamentoItemEtiqueta
// — o motor M2/flexografia de rótulo. Este arquivo espelha o mesmo padrão
// (lista fechada + OUTRO + rótulo em pt-BR) pra dobra/encadernação/colagem,
// referenciados direto por ItemGrafica (não por uma linha de orçamento) —
// ver comentário do campo no schema (prisma/schema/06-catalogo.prisma).
//
// IMPORTANTE: puramente descritivo/organizacional. NUNCA importar isto (nem
// os campos tipoDobra/tipoEncadernacao/tipoColagem de ItemGrafica) de dentro
// de src/lib/pricing/ — não participa de nenhum cálculo de custo/preço.

export type TipoDobra = "MEIA_DOBRA" | "SANFONA" | "CARTA" | "PARALELA" | "OUTRO";

export const TIPOS_DOBRA: TipoDobra[] = ["MEIA_DOBRA", "SANFONA", "CARTA", "PARALELA", "OUTRO"];

export const ROTULO_TIPO_DOBRA: Record<TipoDobra, string> = {
  MEIA_DOBRA: "Meia dobra",
  SANFONA: "Sanfona",
  CARTA: "Carta",
  PARALELA: "Paralela",
  OUTRO: "Outro",
};

export type TipoEncadernacao = "BROCHURA" | "WIRE_O" | "ESPIRAL" | "CAPA_DURA" | "OUTRO";

export const TIPOS_ENCADERNACAO: TipoEncadernacao[] = [
  "BROCHURA",
  "WIRE_O",
  "ESPIRAL",
  "CAPA_DURA",
  "OUTRO",
];

export const ROTULO_TIPO_ENCADERNACAO: Record<TipoEncadernacao, string> = {
  BROCHURA: "Brochura",
  WIRE_O: "Wire-o",
  ESPIRAL: "Espiral",
  CAPA_DURA: "Capa dura",
  OUTRO: "Outro",
};

export type TipoColagem = "COLA_FRIA" | "COLA_QUENTE" | "PUR" | "OUTRO";

export const TIPOS_COLAGEM: TipoColagem[] = ["COLA_FRIA", "COLA_QUENTE", "PUR", "OUTRO"];

export const ROTULO_TIPO_COLAGEM: Record<TipoColagem, string> = {
  COLA_FRIA: "Cola fria",
  COLA_QUENTE: "Cola quente (hot melt)",
  PUR: "PUR",
  OUTRO: "Outro",
};

// Mesma resolução de rótulo de rotuloUnidadeCompra (src/lib/unidade-compra.ts):
// se o tipo escolhido = OUTRO, usa o texto livre; senão usa o rótulo fixo.
export function rotuloTipoDobra(tipo: string | null | undefined, outro?: string | null): string {
  if (!tipo) return "";
  if (tipo === "OUTRO") return outro?.trim() || ROTULO_TIPO_DOBRA.OUTRO;
  return ROTULO_TIPO_DOBRA[tipo as TipoDobra] ?? tipo;
}

export function rotuloTipoEncadernacao(
  tipo: string | null | undefined,
  outro?: string | null
): string {
  if (!tipo) return "";
  if (tipo === "OUTRO") return outro?.trim() || ROTULO_TIPO_ENCADERNACAO.OUTRO;
  return ROTULO_TIPO_ENCADERNACAO[tipo as TipoEncadernacao] ?? tipo;
}

export function rotuloTipoColagem(tipo: string | null | undefined, outro?: string | null): string {
  if (!tipo) return "";
  if (tipo === "OUTRO") return outro?.trim() || ROTULO_TIPO_COLAGEM.OUTRO;
  return ROTULO_TIPO_COLAGEM[tipo as TipoColagem] ?? tipo;
}
