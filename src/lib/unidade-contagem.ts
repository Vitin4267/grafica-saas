import { rotuloUnidade } from "@/lib/unidade";
import { formatoMoeda } from "@/lib/moeda";

export type ConversaoPreco = { rotulo: string; valorFormatado: string };

// Camada de exibição pura — NUNCA recalcula preço, só multiplica o preço
// unitário (já calculado pelo motor) por um fator de conversão pra mostrar
// "também custa R$X por milheiro/rolo". Reaproveita dois campos que já
// existiam mortos no schema: ItemGrafica.unidadeContagem/fatorConversao (fixo
// por produto, ex: "vende por milheiro") e
// OrcamentoItemEtiqueta.embalagemQtdPorRolo (varia por pedido). Sem nenhum
// dos dois configurados, devolve array vazio — zero mudança visual pra quem
// não usa isso.
export function calcularConversoesPreco(params: {
  precoUnitario: number;
  unidadeContagem: string | null;
  unidadeContagemOutro?: string | null;
  fatorConversao: number | null;
  embalagemQtdPorRolo: number | null;
}): ConversaoPreco[] {
  const conversoes: ConversaoPreco[] = [];

  if (
    params.unidadeContagem &&
    params.fatorConversao !== null &&
    Number.isFinite(params.fatorConversao) &&
    params.fatorConversao > 0
  ) {
    const valor = params.precoUnitario * params.fatorConversao;
    conversoes.push({
      rotulo: rotuloUnidade(params.unidadeContagem, params.unidadeContagemOutro),
      valorFormatado: formatoMoeda.format(valor),
    });
  }

  if (
    params.embalagemQtdPorRolo !== null &&
    Number.isFinite(params.embalagemQtdPorRolo) &&
    params.embalagemQtdPorRolo > 0
  ) {
    const valor = params.precoUnitario * params.embalagemQtdPorRolo;
    conversoes.push({
      rotulo: `rolo (${params.embalagemQtdPorRolo} un.)`,
      valorFormatado: formatoMoeda.format(valor),
    });
  }

  return conversoes;
}
