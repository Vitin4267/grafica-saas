import "server-only";
import { prisma } from "@/lib/prisma";

// Único arquivo que toca Prisma pro reajuste em lote (mesmo espírito de
// src/lib/pricing/carregar.ts) — usado tanto pela Server Action (preview e
// aplicar, cada uma recalculando do zero, nunca confiando no cliente) quanto
// pela página (só pra listar as categorias elegíveis).
export function buscarItensReajustaveis(graficaId: string, categoriaFiltro: string | null) {
  return prisma.itemGrafica.findMany({
    where: {
      graficaId,
      ativo: true,
      precoVenda: { not: null },
      // Só SIMPLES: em M2/OFFSET o preço de verdade vem do motor de custo +
      // margem (src/lib/pricing/), precoVenda nunca é lido nesse caminho.
      modeloCalculo: "SIMPLES",
      ...(categoriaFiltro ? { itemCatalogo: { categoria: categoriaFiltro } } : {}),
    },
    include: { itemCatalogo: true },
    orderBy: { itemCatalogo: { nome: "asc" } },
  });
}
