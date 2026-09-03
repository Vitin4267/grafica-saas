import { type Dec, paraDecimal, maiorDec } from "./decimal";
import { validarPedidoTempoMaquina } from "./validar";
import type { ParametrosMaquinaTempo, PedidoTempoMaquina } from "./tipos";

export type ResultadoTempoMaquina = {
  custoTempo: Dec;
  custoCorte: Dec;
  custoSetup: Dec;
  custoBase: Dec;
};

// Achado A6 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// Parte 1): corte/gravação a laser, router CNC, plotter de recorte,
// montagem de letra caixa/totem — nada disso tem modelo hoje (Equipamento
// existe só como cadastro informativo, nunca influencia preço). Fórmula do
// setor (pesquisa: Porto Aço e Ferro, PrintCal, Ranger3D, FortuneLaser): o
// custo principal é o TEMPO de máquina, com algumas gráficas cobrando por
// CENTÍMETRO/METRO de corte em vez de (ou além de) tempo. A gráfica escolhe
// a base na máquina: tempoEstimadoMin e/ou metrosCorte, cada um opcional e
// independente — o motor só cobra o que estiver preenchido no PEDIDO.
// custoSetupPorJob é 1× por item (não escala com Q), mesmo princípio de
// custoPorSetup em setup-por-peça e custoMatrizDigitalizacao em bordado.
// Sem substrato: TEMPO_MAQUINA não representa o material em si (isso é
// FichaTecnicaItem/M2/CHAPA_RIGIDA), só o tempo de máquina que ele consome.
export function calcularTempoMaquina(
  pedido: PedidoTempoMaquina,
  params: ParametrosMaquinaTempo
): ResultadoTempoMaquina {
  validarPedidoTempoMaquina(pedido);

  const custoTempo =
    pedido.tempoEstimadoMin !== undefined
      ? paraDecimal(pedido.tempoEstimadoMin).dividedBy(60).times(params.custoHoraMaq)
      : paraDecimal(0);
  const custoCorte =
    pedido.metrosCorte !== undefined
      ? paraDecimal(pedido.metrosCorte).times(params.custoPorMetroCorte)
      : paraDecimal(0);
  const custoSetup = paraDecimal(params.custoSetupPorJob);

  // Mesma fórmula de piso que os outros motores sem nesting já usam (max
  // contra custoMinimo).
  const custoBase = maiorDec(paraDecimal(params.custoMinimo), custoTempo.plus(custoCorte).plus(custoSetup));

  return {
    custoTempo,
    custoCorte,
    custoSetup,
    custoBase,
  };
}
