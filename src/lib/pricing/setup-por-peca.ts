import { type Dec, paraDecimal, maiorDec } from "./decimal";
import { validarPedidoSetupPorPeca } from "./validar";
import type { ParametrosMaquinaSetupPorPeca, PedidoSetupPorPeca } from "./tipos";

export type ResultadoSetupPorPeca = {
  custoSetup: Dec;
  custoVariavel: Dec;
  custoBase: Dec;
};

// Motor COMPARTILHADO pelos 3 ModeloCalculo de "setup por peça" —
// SERIGRAFIA, SUBLIMACAO, ESTAMPAGEM_QUENTE. Os 3 processos têm exatamente a
// mesma forma de custo (fixo por tela/matriz/arte + variável por peça +
// piso do job), então usam 1 função só em vez de triplicar código quase
// idêntico — só o ModeloCalculo do produto e a MaquinaSetupPorPeca
// selecionada (filtrada por tipoProcesso na configuração do produto) mudam.
// Sem nesting: não há bobina/folha, mesma filosofia do Digital.
export function calcularSetupPorPeca(
  pedido: PedidoSetupPorPeca,
  params: ParametrosMaquinaSetupPorPeca
): ResultadoSetupPorPeca {
  validarPedidoSetupPorPeca(pedido);

  const Q = pedido.quantidade;

  const custoSetup = paraDecimal(pedido.numeroSetups).times(params.custoPorSetup);
  const custoVariavel = paraDecimal(Q).times(params.custoPorPeca);
  // Mesma fórmula de piso que acabamento.ts já usa (max contra custoMinimo).
  const custoBase = maiorDec(paraDecimal(params.custoMinimo), custoSetup.plus(custoVariavel));

  return {
    custoSetup,
    custoVariavel,
    custoBase,
  };
}
