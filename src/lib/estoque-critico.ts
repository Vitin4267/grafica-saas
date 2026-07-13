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

// Snapshot (não transição): estoque no limite ou abaixo dele agora, seja
// qual for a causa (baixa de produção, edição manual, estorno incompleto).
// Usado por verificarEDispararAlertaEstoque (src/lib/alerta-estoque.ts), que
// roda sob demanda comparando esse snapshot contra o dedup já registrado —
// diferente de cruzouLimiteMinimo, que precisa do antes/depois de uma
// operação específica.
export function estoqueEstaCritico(estoqueAtual: number | null, estoqueMinimo: number | null): boolean {
  if (estoqueAtual === null || estoqueMinimo === null) return false;
  return estoqueAtual <= estoqueMinimo;
}
