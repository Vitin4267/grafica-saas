import { D, type Dec, arredondarParaIncremento } from "@/lib/pricing/decimal";

// Só faz sentido pra itens SIMPLES — nesses, ItemGrafica.precoVenda É o
// preço final. Em M2/OFFSET o preço é sempre recalculado a partir de custo +
// margem (ver src/lib/pricing/), precoVenda nunca é lido nesse caminho — por
// isso o reajuste em lote nem tenta mexer nesses itens (ver
// src/app/catalogo/reajuste/actions.ts).
export function calcularNovoPreco(precoAtual: Dec, percentual: number, incremento: Dec): Dec {
  const fator = new D(1).plus(new D(percentual).div(100));
  return arredondarParaIncremento(precoAtual.times(fator), incremento);
}
