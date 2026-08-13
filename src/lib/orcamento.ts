export type ParametrosPreco = {
  precoBase: number;
  quantidade: number;
  larguraCm?: number | null;
  alturaCm?: number | null;
};

// Produtos com largura/altura são precificados por m² (ex: banners e lonas).
// Produtos sem dimensões são precificados por unidade (ex: cartão de visita, panfleto).
export function calcularPreco({
  precoBase,
  quantidade,
  larguraCm,
  alturaCm,
}: ParametrosPreco) {
  const temDimensoes = Boolean(larguraCm && alturaCm);
  const areaM2 = temDimensoes ? (larguraCm! / 100) * (alturaCm! / 100) : 1;

  // precoUnitario é a fonte única de verdade pro arredondamento: arredonda
  // pra 2 casas aqui (mesma precisão da coluna Decimal(12,2) do Postgres) e
  // deriva precoTotal multiplicando o valor já arredondado pela quantidade
  // (arredondando de novo só pra corrigir epsilon de ponto flutuante, já que
  // quantidade é inteira). Assim as duas colunas sempre batem entre si, e
  // qualquer SUM(precoTotal) feito depois também bate com unitário × quantidade.
  const precoUnitario = Math.round(precoBase * areaM2 * 100) / 100;
  const precoTotal = Math.round(precoUnitario * quantidade * 100) / 100;

  return { precoUnitario, precoTotal, areaM2, temDimensoes };
}
