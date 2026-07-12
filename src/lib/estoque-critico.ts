// Decide se uma baixa de estoque cruzou o limite mínimo cadastrado — usado
// pra disparar o evento estoque_critico só na transição (estava OK, ficou
// crítico), nunca em toda baixa subsequente que já estava abaixo do mínimo
// (evita spam de notificação a cada pedido).
export function cruzouLimiteMinimo(
  estoqueAntes: number,
  estoqueDepois: number,
  estoqueMinimo: number | null
): boolean {
  if (estoqueMinimo === null) return false;
  return estoqueAntes > estoqueMinimo && estoqueDepois <= estoqueMinimo;
}
