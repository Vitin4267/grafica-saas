// Comparativo de preço por fornecedor pra uma mesma matéria-prima — agrupa o
// histórico de ENTRADA_COMPRA (MovimentacaoEstoque) que já existe por
// fornecedor, ordenando do mais barato pro mais caro pela compra mais
// recente de cada um. Puramente derivado de dado que já é lançado no fluxo
// de Compras (avancarStatusCompra grava custoUnitario em RECEBIDO) — não
// introduz nenhum novo lançamento nem tabela.
//
// Lógica pura, sem Prisma, pra poder testar sem banco — a leitura do banco
// fica em comparativo-fornecedores-db.ts (mesma separação de
// previsao-estoque.ts/previsao-estoque-db.ts).

// Quantas compras aparecem no histórico de cada fornecedor na tela —
// suficiente pra enxergar tendência de preço sem virar uma lista infinita.
export const MAX_HISTORICO_POR_FORNECEDOR = 5;

export type CompraBruta = {
  itemGraficaId: string;
  varianteId: string | null;
  fornecedorId: string;
  fornecedorNome: string;
  custoUnitario: number;
  criadaEm: Date;
};

export type CompraHistorico = {
  preco: number;
  data: Date;
};

export type LinhaComparativoFornecedor = {
  fornecedorId: string;
  fornecedorNome: string;
  ultimoPreco: number;
  ultimaCompraEm: Date;
  // Mais recente primeiro, no máximo MAX_HISTORICO_POR_FORNECEDOR compras.
  historico: CompraHistorico[];
};

// Chave de agrupamento: variante quando existe, senão a matéria-prima "pai"
// — mesma convenção de calcularPrevisaoEstoque (o id da previsão é
// itemGraficaId OU varianteId), porque variante tem preço/estoque próprios.
export function chaveComparativo(itemGraficaId: string, varianteId: string | null | undefined): string {
  return varianteId ?? itemGraficaId;
}

// Agrupa compras brutas (já filtradas por gráfica/tipo=ENTRADA_COMPRA) por
// matéria-prima/variante e, dentro de cada uma, por fornecedor — devolve um
// Map de chave (ver chaveComparativo) pra lista de fornecedores ordenada do
// mais barato pro mais caro (comparando o preço da compra MAIS RECENTE de
// cada fornecedor, não a média histórica — é o que responde "com quem eu
// cotaria hoje").
export function montarComparativoFornecedores(
  compras: CompraBruta[]
): Map<string, LinhaComparativoFornecedor[]> {
  const porChave = new Map<string, Map<string, CompraBruta[]>>();

  for (const compra of compras) {
    const chave = chaveComparativo(compra.itemGraficaId, compra.varianteId);
    let porFornecedor = porChave.get(chave);
    if (!porFornecedor) {
      porFornecedor = new Map();
      porChave.set(chave, porFornecedor);
    }
    const lista = porFornecedor.get(compra.fornecedorId);
    if (lista) {
      lista.push(compra);
    } else {
      porFornecedor.set(compra.fornecedorId, [compra]);
    }
  }

  const resultado = new Map<string, LinhaComparativoFornecedor[]>();
  for (const [chave, porFornecedor] of porChave) {
    const linhas: LinhaComparativoFornecedor[] = [];
    for (const comprasDoFornecedor of porFornecedor.values()) {
      const ordenadas = [...comprasDoFornecedor].sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime());
      const maisRecente = ordenadas[0];
      linhas.push({
        fornecedorId: maisRecente.fornecedorId,
        fornecedorNome: maisRecente.fornecedorNome,
        ultimoPreco: maisRecente.custoUnitario,
        ultimaCompraEm: maisRecente.criadaEm,
        historico: ordenadas
          .slice(0, MAX_HISTORICO_POR_FORNECEDOR)
          .map((compra) => ({ preco: compra.custoUnitario, data: compra.criadaEm })),
      });
    }
    linhas.sort((a, b) => a.ultimoPreco - b.ultimoPreco);
    resultado.set(chave, linhas);
  }

  return resultado;
}
