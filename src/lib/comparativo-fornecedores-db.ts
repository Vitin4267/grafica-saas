import "server-only";
import { prisma } from "@/lib/prisma";
import {
  montarComparativoFornecedores,
  type LinhaComparativoFornecedor,
  type CompraBruta,
} from "@/lib/comparativo-fornecedores";

// Busca todo o histórico de ENTRADA_COMPRA com fornecedor e custo conhecidos
// desta gráfica e monta o comparativo por matéria-prima/variante — usado
// pela tela de Nova solicitação de compra pra mostrar, ao escolher o item,
// quem já vendeu isso e por quanto (ver comparativo-fornecedores.ts pra
// lógica de agrupamento/ordenação). Sem filtro de item aqui de propósito:
// a tela precisa do comparativo de TODAS as matérias-primas ativas de uma
// vez (o usuário troca a seleção no client sem round-trip ao servidor).
export async function buscarComparativoFornecedores(
  graficaId: string
): Promise<Map<string, LinhaComparativoFornecedor[]>> {
  const compras = await prisma.movimentacaoEstoque.findMany({
    where: {
      tipo: "ENTRADA_COMPRA",
      fornecedorId: { not: null },
      custoUnitario: { not: null },
      itemGrafica: { graficaId },
    },
    select: {
      itemGraficaId: true,
      varianteId: true,
      fornecedorId: true,
      custoUnitario: true,
      createdAt: true,
      fornecedor: { select: { nome: true } },
    },
  });

  const bruto: CompraBruta[] = compras
    // fornecedorId/custoUnitario já filtrados no where, mas o tipo do Prisma
    // continua opcional — o `filter` abaixo só satisfaz o TypeScript sem
    // mudar o resultado.
    .filter((compra) => compra.fornecedorId !== null && compra.custoUnitario !== null && compra.fornecedor !== null)
    .map((compra) => ({
      itemGraficaId: compra.itemGraficaId,
      varianteId: compra.varianteId,
      fornecedorId: compra.fornecedorId!,
      fornecedorNome: compra.fornecedor!.nome,
      custoUnitario: Number(compra.custoUnitario),
      criadaEm: compra.createdAt,
    }));

  return montarComparativoFornecedores(bruto);
}
