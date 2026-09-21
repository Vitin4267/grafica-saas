export type ParametrosPreco = {
  precoBase: number;
  quantidade: number;
  larguraCm?: number | null;
  alturaCm?: number | null;
  // Achado N1 da auditoria de abrangência (Parte 7) — propriedade do PRODUTO
  // (ItemGrafica.simplesCobraPorArea), não mais inferida de o vendedor ter
  // preenchido largura/altura naquela linha do orçamento. false/ausente =
  // cobra por peça sempre, mesmo com dimensões preenchidas (podem ser só
  // descritivas, ex: área da estampa numa camiseta) — comportamento padrão
  // de todo produto. true = mesmo cálculo por m² de sempre, quando as
  // dimensões estiverem preenchidas.
  simplesCobraPorArea?: boolean;
};

// Produtos SIMPLES são precificados por unidade (ex: cartão de visita,
// camiseta) por padrão. Só multiplica pela área quando o PRODUTO está
// marcado como "cobra por área" (ver comentário de simplesCobraPorArea
// acima) — nunca só por o vendedor ter preenchido largura/altura, que podem
// ser puramente descritivas nesse caso.
export function calcularPreco({
  precoBase,
  quantidade,
  larguraCm,
  alturaCm,
  simplesCobraPorArea = false,
}: ParametrosPreco) {
  const temDimensoes = Boolean(larguraCm && alturaCm);
  const cobraPorArea = simplesCobraPorArea && temDimensoes;
  const areaM2 = cobraPorArea ? (larguraCm! / 100) * (alturaCm! / 100) : 1;

  // precoUnitario é a fonte única de verdade pro arredondamento: arredonda
  // aqui e deriva precoTotal multiplicando o valor já arredondado pela
  // quantidade (arredondando de novo só pra corrigir epsilon de ponto
  // flutuante, já que quantidade é inteira). Assim as duas colunas sempre
  // batem entre si, e qualquer SUM(precoTotal) feito depois também bate com
  // unitário × quantidade.
  //
  // Achado da auditoria de precificação (2026-09-21) — 4 casas (não 2): ver
  // o mesmo comentário em src/lib/pricing/compor.ts (comporPreco) pro
  // raciocínio completo. Aqui o preço-base (ItemGrafica.precoVenda) também
  // ganhou precisão (Decimal(12,4), migration 20260921120000), então um
  // produto SIMPLES cobrado por área de alto valor de área (ex: banner por
  // m² a preço fracionário) já não perde precisão nem na entrada nem aqui.
  const precoUnitario = Math.round(precoBase * areaM2 * 10000) / 10000;
  const precoTotal = Math.round(precoUnitario * quantidade * 10000) / 10000;

  return { precoUnitario, precoTotal, areaM2, temDimensoes, cobraPorArea };
}
