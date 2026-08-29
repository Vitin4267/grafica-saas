// Lógica pura de cotações de fornecedor (achado A4 da auditoria de
// abrangência, Parte 3/Compras) — "mapa de cotação": registrar preço, prazo
// e condição de pagamento de vários fornecedores pra uma mesma solicitação
// de compra, e escolher a vencedora antes de aprovar.
//
// Lógica pura, sem Prisma, pra poder testar sem banco — a leitura do banco
// fica em cotacao-fornecedor-db.ts (mesma separação de
// previsao-estoque.ts/previsao-estoque-db.ts e
// comparativo-fornecedores.ts/-db.ts).

export type CotacaoBruta = {
  fornecedorId: string;
  fornecedorNome: string;
  precoUnitario: number;
  condicaoPagamento: string | null;
  prazoEntregaDias: number | null;
  frete: number | null;
  criadaEm: Date;
};

// Dado o histórico de cotações já registradas (de QUALQUER solicitação de
// compra da gráfica) pra uma mesma matéria-prima/variante, devolve só a mais
// recente de cada fornecedor — usado pra pré-preencher o formulário de nova
// cotação (ver achado A4: "Pré-preencher com o último preço de cada
// fornecedor"), ordenado do mais barato pro mais caro (mesmo critério de
// montarComparativoFornecedores).
export function ultimasCotacoesPorFornecedor(cotacoes: CotacaoBruta[]): CotacaoBruta[] {
  const porFornecedor = new Map<string, CotacaoBruta>();
  for (const cotacao of cotacoes) {
    const atual = porFornecedor.get(cotacao.fornecedorId);
    if (!atual || cotacao.criadaEm.getTime() > atual.criadaEm.getTime()) {
      porFornecedor.set(cotacao.fornecedorId, cotacao);
    }
  }
  return Array.from(porFornecedor.values()).sort((a, b) => a.precoUnitario - b.precoUnitario);
}
