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

  const precoUnitario = precoBase * areaM2;
  const precoTotal = precoUnitario * quantidade;

  return { precoUnitario, precoTotal, areaM2, temDimensoes };
}
