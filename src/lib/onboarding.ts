import { prisma } from "@/lib/prisma";

export async function obterStatusOnboarding(graficaId: string) {
  const [totalClientes, totalItensVendaveis, totalOrcamentos] = await Promise.all([
    prisma.cliente.count({ where: { graficaId } }),
    prisma.itemGrafica.count({
      where: { graficaId, ativo: true, precoVenda: { not: null } },
    }),
    prisma.orcamento.count({ where: { graficaId } }),
  ]);

  return {
    temCliente: totalClientes > 0,
    temCatalogo: totalItensVendaveis > 0,
    // Passo 4 do checklist de /comecar ("Gere seu primeiro orçamento") — não
    // entra em `completo` (mantido com o significado original de "pronto pra
    // montar um orçamento"), só marca esse passo como concluído na tela.
    temOrcamento: totalOrcamentos > 0,
    totalClientes,
    totalOrcamentos,
    completo: totalClientes > 0 && totalItensVendaveis > 0,
  };
}
