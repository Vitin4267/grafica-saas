import "server-only";
import { prisma } from "@/lib/prisma";
import { ultimasCotacoesPorFornecedor, type CotacaoBruta } from "@/lib/cotacao-fornecedor";

// Busca o último preço cotado de cada fornecedor pra esta matéria-prima/
// variante, olhando TODAS as solicitações de compra da gráfica (não só a
// atual) — é o que permite pré-preencher "Suzano cotou R$5,20 da última vez"
// mesmo numa solicitação nova, sem esperar o fornecedor ser recotado do
// zero. Usado pela tela de detalhe da solicitação (ver [id]/page.tsx) ao
// montar o formulário de nova cotação.
//
// Limitação conhecida: CotacaoFornecedor não guarda itemGraficaId/varianteId
// direto (só via solicitacaoCompraId) — a busca abaixo depende do join pra
// filtrar por item, sem índice dedicado pra essa combinação. Funciona bem no
// volume atual de uma gráfica (dezenas/centenas de cotações), mas não
// escalaria sem uma coluna desnormalizada se o catálogo de matéria-prima
// crescer muito — aceitável por ora, documentado aqui em vez de forçar uma
// solução prematura.
export async function buscarUltimasCotacoesPorItem(
  graficaId: string,
  itemGraficaId: string,
  varianteId: string | null
): Promise<CotacaoBruta[]> {
  const cotacoes = await prisma.cotacaoFornecedor.findMany({
    where: {
      solicitacaoCompra: { graficaId, itemGraficaId, varianteId },
    },
    select: {
      fornecedorId: true,
      precoUnitario: true,
      condicaoPagamento: true,
      prazoEntregaDias: true,
      frete: true,
      createdAt: true,
      fornecedor: { select: { nome: true } },
    },
  });

  const bruto: CotacaoBruta[] = cotacoes.map((c) => ({
    fornecedorId: c.fornecedorId,
    fornecedorNome: c.fornecedor.nome,
    precoUnitario: Number(c.precoUnitario),
    condicaoPagamento: c.condicaoPagamento,
    prazoEntregaDias: c.prazoEntregaDias,
    frete: c.frete !== null ? Number(c.frete) : null,
    criadaEm: c.createdAt,
  }));

  return ultimasCotacoesPorFornecedor(bruto);
}
