// Gera uma chave só pra `key` de linha em listas editáveis no client (bobinas,
// formatos de folha, ficha técnica, carrinho de orçamento) — nunca persistida,
// só precisa ser única o bastante pro React reconciliar a lista.
export function gerarChave(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}
