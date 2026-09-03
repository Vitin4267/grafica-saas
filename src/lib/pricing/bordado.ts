import { type Dec, paraDecimal, maiorDec } from "./decimal";
import { validarPedidoBordado } from "./validar";
import type { ContextoBordado, ParametrosMaquinaBordado, PedidoBordado } from "./tipos";

export type ResultadoBordado = {
  custoMatriz: Dec;
  custoPontos: Dec;
  custoSubstrato: Dec;
  custoBase: Dec;
};

// Achado A4 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// Parte 1): bordado não cabe em calcularSetupPorPeca porque lá o custo por
// peça é FIXO na máquina — em bordado o custo por peça varia com o número de
// PONTOS da arte de CADA PEDIDO (um logo de 3.000 pontos e uma arte de
// costas de 15.000 pontos custam 5× diferente na mesma máquina, na mesma
// camiseta). Fórmula do setor (pesquisa: HoopTalent, O Artesão Bordados,
// Fiarte): (pontos ÷ 1000) × preço por 1000 pontos + taxa de matriz/
// digitalização (1× por arte, não por peça) + custo da peça em branco.
// Sem nesting, mesma filosofia de calcularSetupPorPeca/calcularDigital —
// custoMatrizDigitalizacao é o equivalente do clichê de etiqueta (1× por
// pedido, nunca escala com Q).
export function calcularBordado(
  pedido: PedidoBordado,
  contexto: ContextoBordado,
  params: ParametrosMaquinaBordado
): ResultadoBordado {
  validarPedidoBordado(pedido, contexto);

  const Q = pedido.quantidade;

  const custoMatriz = paraDecimal(params.custoMatrizDigitalizacao);
  const custoPontos = paraDecimal(pedido.numeroPontos)
    .dividedBy(1000)
    .times(params.custoPorMilPontos);
  const custoPontosTotal = custoPontos.times(Q);
  const custoSubstrato = paraDecimal(Q).times(contexto.custoSubstratoPorPeca);
  // Mesma fórmula de piso que setup-por-peça/acabamento já usam (max contra
  // custoMinimo).
  const custoBase = maiorDec(
    paraDecimal(params.custoMinimo),
    custoMatriz.plus(custoPontosTotal).plus(custoSubstrato)
  );

  return {
    custoMatriz,
    custoPontos: custoPontosTotal,
    custoSubstrato,
    custoBase,
  };
}
