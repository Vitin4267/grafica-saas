// Achado B4 da auditoria de abrangência — prazo é por orçamento, nunca por
// item. OrcamentoItem.prazoEstimadoDias (opcional, por item) complementa
// Orcamento.prazoEntregaEstimadoDias (único no cabeçalho, preenchido à mão).
//
// Função pura: o "prazo efetivo" exibido/usado é sempre o MAIOR entre o
// valor do cabeçalho e o maior valor entre os itens preenchidos — nunca
// menor que o que o vendedor já digitou manualmente no cabeçalho (evita
// sub-prometer), e reflete automaticamente um item com prazo mais longo
// (evita sub-prometer o item mais demorado). Gráfica que nunca usa o campo
// por item continua com o comportamento de hoje: só o valor do cabeçalho.
export function calcularPrazoEfetivoDias(
  prazoCabecalho: number | null,
  itens: { prazoEstimadoDias: number | null }[]
): number | null {
  const candidatos = [prazoCabecalho, ...itens.map((i) => i.prazoEstimadoDias)].filter(
    (p): p is number => p !== null
  );
  if (candidatos.length === 0) return null;
  return Math.max(...candidatos);
}
