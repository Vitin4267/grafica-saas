// Cálculo puro (sem Prisma) — testável isoladamente, mesmo padrão de
// previsao-estoque.ts. A consulta ao banco fica em meu-negocio.ts.

// "Saiu de RASCUNHO" = status atual ENVIADO, APROVADO ou REJEITADO — RASCUNHO
// nunca entra no denominador porque o cliente ainda nem viu o orçamento, não
// faz sentido contar como "oportunidade perdida".
const STATUS_SAIU_DE_RASCUNHO = ["ENVIADO", "APROVADO", "REJEITADO"];

export type TaxaConversaoOrcamentos = {
  saidosDeRascunho: number;
  aprovados: number;
  // null quando não há nenhum orçamento fora de RASCUNHO no período — não dá
  // pra calcular taxa sem denominador, e 0% seria enganoso (sugere "todo
  // mundo recusou" quando na verdade é "não tem dado ainda").
  percentual: number | null;
};

export function calcularTaxaConversao(
  funil: { status: string; quantidade: number }[]
): TaxaConversaoOrcamentos {
  const quantidadePorStatus = new Map(funil.map((f) => [f.status, f.quantidade]));
  const aprovados = quantidadePorStatus.get("APROVADO") ?? 0;
  const saidosDeRascunho = STATUS_SAIU_DE_RASCUNHO.reduce(
    (soma, status) => soma + (quantidadePorStatus.get(status) ?? 0),
    0
  );
  return {
    saidosDeRascunho,
    aprovados,
    percentual: saidosDeRascunho === 0 ? null : (aprovados / saidosDeRascunho) * 100,
  };
}

// Só entram orçamentos aprovados que passaram pelo link público — aprovação
// interna direta (vendedor marca como aprovado sem o cliente responder, ver
// orcamento/[id]/actions.ts) não tem respostaPublicaEm e não representa
// "tempo até o cliente decidir".
export function calcularTempoMedioAprovacaoDias(
  orcamentosAprovados: { createdAt: Date; respostaPublicaEm: Date | null }[]
): number | null {
  const duracoesDias = orcamentosAprovados
    .filter((o) => o.respostaPublicaEm !== null)
    .map((o) => (o.respostaPublicaEm!.getTime() - o.createdAt.getTime()) / (1000 * 60 * 60 * 24));

  if (duracoesDias.length === 0) return null;

  return duracoesDias.reduce((soma, dias) => soma + dias, 0) / duracoesDias.length;
}
