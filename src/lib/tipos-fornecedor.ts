import type { CategoriaFornecedor, CondicaoPagamentoFornecedor } from "@/generated/prisma/enums";

// Achado A5 da Parte 3 (Compras) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md) — ver comentário do model Fornecedor em
// prisma/schema/08-compras.prisma. Lista fechada com OUTRO de escape, mesmo
// padrão de tipos-prestador-servico.ts.
export const ORDEM_CATEGORIA_FORNECEDOR: CategoriaFornecedor[] = [
  "PAPEL_CARTAO",
  "TINTA_VERNIZ",
  "CHAPA_CLICHE_MATRIZ",
  "SUBSTRATO_RIGIDO",
  "TECIDO_LINHA_BORDADO",
  "BRINDE_PROMOCIONAL",
  "ACABAMENTO_TERCEIRIZADO",
  "OUTRO",
];

export const ROTULO_CATEGORIA_FORNECEDOR: Record<CategoriaFornecedor, string> = {
  PAPEL_CARTAO: "Papel e cartão",
  TINTA_VERNIZ: "Tinta e verniz",
  CHAPA_CLICHE_MATRIZ: "Chapa, clichê e matriz",
  SUBSTRATO_RIGIDO: "Substrato rígido (PVC, ACM, MDF...)",
  TECIDO_LINHA_BORDADO: "Tecido e linha de bordado",
  BRINDE_PROMOCIONAL: "Brinde promocional",
  ACABAMENTO_TERCEIRIZADO: "Acabamento terceirizado",
  OUTRO: "Outro",
};

// Cai pra categoriaOutro quando a categoria é o escape hatch OUTRO — mesmo
// padrão de rotuloTipoPrestadorServico.
export function rotuloCategoriaFornecedor(
  categoria: CategoriaFornecedor | null,
  categoriaOutro: string | null
): string {
  if (!categoria) return "—";
  return categoria === "OUTRO" ? (categoriaOutro ?? "Outro") : ROTULO_CATEGORIA_FORNECEDOR[categoria];
}

// "Jeito de pagar" negociado com o fornecedor — DELIBERADAMENTE separado do
// model CondicaoPagamento (motor de parcelas/âncora do lado do cliente/
// venda, ver comentário no enum CondicaoPagamentoFornecedor no schema).
export const ORDEM_CONDICAO_PAGAMENTO_FORNECEDOR: CondicaoPagamentoFornecedor[] = [
  "A_VISTA",
  "BOLETO_30_60_90",
  "PIX",
  "OUTRO",
];

export const ROTULO_CONDICAO_PAGAMENTO_FORNECEDOR: Record<CondicaoPagamentoFornecedor, string> = {
  A_VISTA: "À vista",
  BOLETO_30_60_90: "Boleto 30/60/90",
  PIX: "Pix",
  OUTRO: "Outro",
};

export function rotuloCondicaoPagamentoFornecedor(
  condicao: CondicaoPagamentoFornecedor | null,
  condicaoOutro: string | null
): string {
  if (!condicao) return "—";
  return condicao === "OUTRO"
    ? (condicaoOutro ?? "Outro")
    : ROTULO_CONDICAO_PAGAMENTO_FORNECEDOR[condicao];
}
