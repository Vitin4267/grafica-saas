import { type Dec, paraDecimal } from "./decimal";
import { validarPedidoDigital } from "./validar";
import type { ContextoDigital, ParametrosImpressoraDigital, PedidoDigital } from "./tipos";

const DEFAULTS_DIGITAL = {
  numeroCliquesPadrao: 1, // 1 clique por peça, quando o pedido não informa
};

export type ResultadoDigital = {
  numeroCliques: number;
  custoCliques: Dec;
  custoSubstrato: Dec;
  custoBase: Dec;
};

// Impressão digital (pequeno formato, tiragem curta) — sem nesting: não há
// bobina/folha, o custo é direto por peça (clique da impressora + substrato
// consumido), diferente do M2/OFFSET/FLEXOGRAFIA que precisam resolver
// aproveitamento de material.
export function calcularDigital(
  pedido: PedidoDigital,
  contexto: ContextoDigital,
  params: ParametrosImpressoraDigital,
  defaults: { numeroCliquesPadrao: number } = DEFAULTS_DIGITAL
): ResultadoDigital {
  validarPedidoDigital(pedido, contexto);

  const Q = pedido.quantidade;
  const numeroCliques = pedido.numeroCliques ?? defaults.numeroCliquesPadrao;

  const custoCliques = paraDecimal(Q).times(numeroCliques).times(params.custoPorClique);
  const custoSubstrato = paraDecimal(Q).times(contexto.custoSubstratoPorPeca);
  const custoBase = custoCliques.plus(custoSubstrato);

  return {
    numeroCliques,
    custoCliques,
    custoSubstrato,
    custoBase,
  };
}
