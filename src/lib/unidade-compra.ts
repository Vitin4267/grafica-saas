// Unidade COMERCIAL de compra — achado A6 da auditoria de abrangência (Parte
// 3/Compras, 2026-08-29). Separada da unidade de ESTOQUE (UnidadeMedida, ver
// src/lib/unidade.ts): o comprador negocia e recebe proposta em R$/tonelada
// ou R$/fardo, não na unidade que o estoque já usa — ver enum UnidadeCompra
// no schema pro raciocínio completo (par uCom/uTrib da NF-e brasileira).
export type UnidadeCompra =
  | "FARDO"
  | "RESMA"
  | "BOBINA"
  | "ROLO"
  | "PALETE"
  | "CAIXA"
  | "UNIDADE"
  | "KG"
  | "TONELADA"
  | "OUTRO";

export const UNIDADES_COMPRA: UnidadeCompra[] = [
  "FARDO",
  "RESMA",
  "BOBINA",
  "ROLO",
  "PALETE",
  "CAIXA",
  "UNIDADE",
  "KG",
  "TONELADA",
  "OUTRO",
];

export const ROTULO_UNIDADE_COMPRA: Record<UnidadeCompra, string> = {
  FARDO: "fardo",
  RESMA: "resma",
  BOBINA: "bobina",
  ROLO: "rolo",
  PALETE: "palete",
  CAIXA: "caixa",
  UNIDADE: "unidade",
  KG: "kg",
  TONELADA: "tonelada",
  // Rótulo genérico — o texto de verdade quando unidadeCompra=OUTRO vem do
  // campo livre (unidadeCompraOutro / unidadeCompraPadraoOutro), nunca deste
  // mapa. Mesmo padrão de ROTULO_UNIDADE.OUTRO em src/lib/unidade.ts.
  OUTRO: "outro",
};

// Mesma resolução de rótulo de rotuloUnidade (src/lib/unidade.ts), pro par
// unidadeCompra/unidadeCompraOutro (ou unidadeCompraPadrao/
// unidadeCompraPadraoOutro) de ItemGrafica/SolicitacaoCompra.
export function rotuloUnidadeCompra(
  unidade: string | null | undefined,
  unidadeOutro?: string | null
): string {
  if (!unidade) return "";
  if (unidade === "OUTRO") return unidadeOutro?.trim() || ROTULO_UNIDADE_COMPRA.OUTRO;
  return ROTULO_UNIDADE_COMPRA[unidade as UnidadeCompra] ?? unidade;
}

// quantidadeCompra × fatorConversaoCompra = quantidade (unidade de estoque)
// — a fórmula central do achado A6. Função pura (sem I/O) pra ser reusada
// tanto na Server Action (criarSolicitacaoCompra) quanto na pré-visualização
// no client (NovaSolicitacaoForm), garantindo que os dois lados calculam
// exatamente da mesma forma.
export function calcularQuantidadeEstoque(quantidadeCompra: number, fatorConversaoCompra: number): number {
  return quantidadeCompra * fatorConversaoCompra;
}

// Aviso NÃO BLOQUEANTE (mesma disciplina de outros avisos desta auditoria,
// ex.: divergência de máquina) de que a quantidade pedida não é múltiplo do
// padrão de embalagem/lote do fornecedor — nunca impede a criação da
// solicitação, só avisa pra o comprador decidir se arredonda ou não.
// Tolerância pequena (1e-6) evita falso positivo por arredondamento de
// ponto flutuante do próprio formulário (ex.: 0.1 + 0.2).
const TOLERANCIA_MULTIPLO = 1e-6;

export function avisoMultiploCompra(
  quantidadeCompra: number,
  multiploCompra: number | null | undefined,
  unidadeRotulo: string
): string | null {
  if (!multiploCompra || multiploCompra <= 0) return null;
  const resto = quantidadeCompra % multiploCompra;
  const restoNormalizado = Math.min(resto, multiploCompra - resto);
  if (restoNormalizado <= TOLERANCIA_MULTIPLO) return null;
  return `Quantidade não é múltiplo de ${multiploCompra} ${unidadeRotulo || "unidade(s)"} — confira antes de enviar (o fornecedor pode arredondar pra cima).`;
}
