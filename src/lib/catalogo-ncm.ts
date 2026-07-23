import "server-only";
import { prisma } from "@/lib/prisma";

export type ResolverItemParaNcmResultado =
  | { ok: true; itemGraficaId: string }
  | { ok: false; motivo: "nao_encontrado" | "item_mestre" };

// itemCatalogoId pode ser um item mestre (graficaId=null, compartilhado
// entre todas as gráficas) ou privado dessa gráfica — em ambos os casos, só
// é acessível daqui se a gráfica atual realmente tem um ItemGrafica
// apontando pra ele (evita editar NCM de item de outro tenant por id
// forjado). Item MESTRE, porém, não pode ser editado por uma gráfica
// qualquer: o NCM se propagaria para o catálogo de todas as outras gráficas
// que também usam esse item, sem elas saberem (achado da auditoria de
// 2026-07-23 — ver src/app/catalogo/[itemGraficaId]/actions.ts).
export async function resolverItemParaNcm(
  itemCatalogoId: string,
  graficaId: string
): Promise<ResolverItemParaNcmResultado> {
  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { itemCatalogoId, graficaId },
    include: { itemCatalogo: true },
  });
  if (!itemGrafica) {
    return { ok: false, motivo: "nao_encontrado" };
  }
  if (itemGrafica.itemCatalogo.graficaId === null) {
    return { ok: false, motivo: "item_mestre" };
  }
  return { ok: true, itemGraficaId: itemGrafica.id };
}
