import { prisma } from "@/lib/prisma";

export async function obterStatusOnboarding(graficaId: string) {
  const [totalClientes, totalItensVendaveis] = await Promise.all([
    prisma.cliente.count({ where: { graficaId } }),
    prisma.itemGrafica.count({
      where: { graficaId, ativo: true, precoVenda: { not: null } },
    }),
  ]);

  return {
    temCliente: totalClientes > 0,
    temCatalogo: totalItensVendaveis > 0,
    totalClientes,
    completo: totalClientes > 0 && totalItensVendaveis > 0,
  };
}
