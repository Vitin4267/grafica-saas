// Sem "server-only" de propósito: são funções puras (rótulo + aritmética),
// sem acesso a banco — o formulário de ajuste manual (client component)
// importa calcularDeltaAjusteInventario pra mostrar o delta em tempo real
// antes de enviar, além do uso nas Server Actions.
import { D } from "@/lib/pricing/decimal";
import type { TipoMovimentacao } from "@/generated/prisma/enums";

// Rótulos em português pro tipo de MovimentacaoEstoque — reaproveitado na
// tela de histórico (catalogo/[itemGraficaId]) e em qualquer outro lugar
// futuro que precise exibir o tipo de forma legível pro dono da gráfica.
export const ROTULOS_TIPO_MOVIMENTACAO: Record<TipoMovimentacao, string> = {
  SAIDA_PRODUCAO: "Baixa de produção",
  ESTORNO_CANCELAMENTO: "Estorno",
  ENTRADA_COMPRA: "Entrada de compra",
  SAIDA_MANUAL: "Saída manual",
  AJUSTE_INVENTARIO: "Ajuste de inventário",
};

// Delta a gravar como `quantidade` de uma MovimentacaoEstoque tipo
// AJUSTE_INVENTARIO: novo valor de estoque (contagem física) menos o valor
// anterior — nunca a contagem em si (ver fase-custo-real.md §4.3). Estoque
// anterior nulo (item nunca teve controle de estoque numérico) conta como
// zero: a primeira contagem física "liga" o controle, não ajusta um número
// que não existia. Usado tanto pelo lançamento manual de ajuste quanto pela
// edição de "estoque atual" no cadastro do item (catalogo/actions.ts) —
// mesma lógica, dois pontos de entrada.
export function calcularDeltaAjusteInventario(estoqueAnterior: number | null, novoEstoque: number): number {
  const anterior = new D(estoqueAnterior ?? 0);
  return new D(novoEstoque).minus(anterior).toNumber();
}
