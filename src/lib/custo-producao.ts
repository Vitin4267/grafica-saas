import "server-only";

import { prisma } from "@/lib/prisma";
import { resolverEtapasGrafica } from "@/lib/etapa-grafica";

export type ItemCustoComparado = {
  materiaPrimaId: string;
  nome: string;
  quantidadeOrcada: number;
  custoOrcado: number;
  quantidadeReal: number;
  custoReal: number;
};

export type ComparacaoCustoPedido = {
  itens: ItemCustoComparado[];
  totalOrcado: number;
  totalReal: number;
};

// Confronta o que a ficha técnica previa consumir (orçado) com o que
// realmente saiu do estoque (MovimentacaoEstoque.tipo=SAIDA ligada a este
// pedido). Usa ItemGrafica.precoCompra ATUAL dos dois lados — não existe
// snapshot histórico de custo de matéria-prima em nenhum outro lugar do app,
// então essa comparação reflete sempre o preço mais recente em ambos os lados
// (não distorce a comparação de quantidade, só a de R$ se olhada bem depois).
export async function buscarCustoRealVsOrcado(
  pedidoId: string,
  graficaId: string
): Promise<ComparacaoCustoPedido | null> {
  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId },
    include: {
      orcamento: {
        include: {
          itens: {
            include: {
              itemGrafica: {
                include: {
                  fichaTecnica: {
                    include: { materiaPrima: { include: { itemCatalogo: true } }, variante: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!pedido) return null;

  // Baixa de estoque só acontece na ENTRADA em PRODUCAO — antes disso (ver
  // resolverEtapasGrafica().estagiosPreProducao, que reflete etapa
  // desativada pra esta gráfica) não há consumo real pra comparar.
  const etapas = await resolverEtapasGrafica(graficaId);
  if (etapas.estagiosPreProducao.includes(pedido.status)) {
    return null;
  }

  const acumulado = new Map<string, ItemCustoComparado>();

  // Chave composta materiaPrimaId+varianteId: matéria-prima com variante (ex:
  // espessura de chapa) tem preço/estoque por variante, então precisa de uma
  // linha própria na comparação — sem variante, varianteId vira "" e a chave
  // colapsa pro comportamento de sempre (1 linha por materiaPrimaId).
  const chave = (materiaPrimaId: string, varianteId: string | null) =>
    `${materiaPrimaId}::${varianteId ?? ""}`;

  const garantirLinha = (materiaPrimaId: string, varianteId: string | null, nome: string) => {
    const k = chave(materiaPrimaId, varianteId);
    let linha = acumulado.get(k);
    if (!linha) {
      linha = { materiaPrimaId, nome, quantidadeOrcada: 0, custoOrcado: 0, quantidadeReal: 0, custoReal: 0 };
      acumulado.set(k, linha);
    }
    return linha;
  };

  for (const item of pedido.orcamento.itens) {
    for (const ficha of item.itemGrafica.fichaTecnica) {
      const nome = ficha.variante
        ? `${ficha.materiaPrima.itemCatalogo.nome} — ${ficha.variante.rotulo}`
        : ficha.materiaPrima.itemCatalogo.nome;
      const linha = garantirLinha(ficha.materiaPrimaId, ficha.varianteId, nome);
      const quantidade = Number(ficha.quantidadePorUnidade) * item.quantidade;
      const precoCompra = ficha.variante?.precoCompra ?? ficha.materiaPrima.precoCompra;
      linha.quantidadeOrcada += quantidade;
      linha.custoOrcado += quantidade * Number(precoCompra ?? 0);
    }
  }

  const movimentacoes = await prisma.movimentacaoEstoque.findMany({
    where: { pedidoId, tipo: "SAIDA_PRODUCAO" },
    include: { itemGrafica: { include: { itemCatalogo: true } }, variante: true },
  });

  for (const mov of movimentacoes) {
    const nome = mov.variante
      ? `${mov.itemGrafica.itemCatalogo.nome} — ${mov.variante.rotulo}`
      : mov.itemGrafica.itemCatalogo.nome;
    const linha = garantirLinha(mov.itemGraficaId, mov.varianteId, nome);
    const quantidade = Number(mov.quantidade);
    const precoCompra = mov.variante?.precoCompra ?? mov.itemGrafica.precoCompra;
    linha.quantidadeReal += quantidade;
    linha.custoReal += quantidade * Number(precoCompra ?? 0);
  }

  const itens = [...acumulado.values()].sort((a, b) => a.nome.localeCompare(b.nome));

  return {
    itens,
    totalOrcado: itens.reduce((soma, item) => soma + item.custoOrcado, 0),
    totalReal: itens.reduce((soma, item) => soma + item.custoReal, 0),
  };
}
