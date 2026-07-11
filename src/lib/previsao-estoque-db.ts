import "server-only";
import { prisma } from "@/lib/prisma";
import { JANELA_DIAS, calcularPrevisaoItem, ordenarPorUrgencia, type PrevisaoMateriaPrima } from "@/lib/previsao-estoque";

// Roda sob demanda (não é cron) — mesma filosofia da geração de despesa
// recorrente: refeito a cada carregamento de página, sem depender de
// infraestrutura de hospedagem ainda não decidida.
export async function calcularPrevisaoEstoque(graficaId: string): Promise<PrevisaoMateriaPrima[]> {
  const desde = new Date();
  desde.setDate(desde.getDate() - JANELA_DIAS);
  const agora = new Date();

  const materiasPrimas = await prisma.itemGrafica.findMany({
    where: {
      graficaId,
      ativo: true,
      itemCatalogo: { tipo: "MATERIA_PRIMA" },
      OR: [
        { estoqueAtual: { not: null } },
        { variantes: { some: { ativo: true, estoqueAtual: { not: null } } } },
      ],
    },
    include: {
      itemCatalogo: true,
      movimentacoes: {
        where: { tipo: "SAIDA", createdAt: { gte: desde } },
        orderBy: { createdAt: "asc" },
      },
      variantes: {
        where: { ativo: true },
        include: {
          movimentacoes: {
            where: { tipo: "SAIDA", createdAt: { gte: desde } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  const montarPrevisao = (
    id: string,
    nome: string,
    categoria: string,
    unidade: string,
    estoqueAtualBruto: number,
    estoqueMinimoBruto: number | null,
    movimentacoes: { quantidade: unknown; createdAt: Date }[]
  ): PrevisaoMateriaPrima => {
    const previsao = calcularPrevisaoItem(
      estoqueAtualBruto,
      movimentacoes.map((m) => ({ quantidade: Number(m.quantidade), createdAt: m.createdAt })),
      agora
    );
    return {
      id,
      nome,
      categoria,
      unidade,
      estoqueAtual: estoqueAtualBruto,
      estoqueMinimo: estoqueMinimoBruto,
      abaixoDoMinimo: estoqueMinimoBruto !== null && estoqueAtualBruto <= estoqueMinimoBruto,
      ...previsao,
    };
  };

  const itens: PrevisaoMateriaPrima[] = [];

  for (const item of materiasPrimas) {
    // Matéria-prima com variantes (ex: espessura de chapa): cada variante é
    // um saldo de estoque próprio, então vira uma linha de previsão própria
    // — o saldo do ItemGrafica "pai" fica sem uso quando há variantes.
    if (item.variantes.length > 0) {
      for (const variante of item.variantes) {
        if (variante.estoqueAtual === null) continue;
        itens.push(
          montarPrevisao(
            variante.id,
            `${item.itemCatalogo.nome} — ${variante.rotulo}`,
            item.itemCatalogo.categoria,
            item.itemCatalogo.unidade ?? "",
            Number(variante.estoqueAtual),
            variante.estoqueMinimo !== null ? Number(variante.estoqueMinimo) : null,
            variante.movimentacoes
          )
        );
      }
      continue;
    }

    if (item.estoqueAtual === null) continue;
    itens.push(
      montarPrevisao(
        item.id,
        item.itemCatalogo.nome,
        item.itemCatalogo.categoria,
        item.itemCatalogo.unidade ?? "",
        Number(item.estoqueAtual),
        item.estoqueMinimo !== null ? Number(item.estoqueMinimo) : null,
        item.movimentacoes
      )
    );
  }

  return ordenarPorUrgencia(itens);
}
