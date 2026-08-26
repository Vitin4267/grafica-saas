import { type Dec, paraDecimal, maiorDec } from "./decimal";
import { validarPedidoSetupPorPeca } from "./validar";
import type {
  ContextoSetupPorPeca,
  ParametrosMaquinaSetupPorPeca,
  PedidoSetupPorPeca,
} from "./tipos";

export type ResultadoSetupPorPeca = {
  custoSetup: Dec;
  custoVariavel: Dec;
  custoSubstrato: Dec;
  custoBase: Dec;
};

// Motor COMPARTILHADO pelos 4 ModeloCalculo de "setup por peça" —
// SERIGRAFIA, SUBLIMACAO, ESTAMPAGEM_QUENTE, PERSONALIZACAO (tampografia,
// gravação a laser, DTG, transfer e o que a gráfica cadastrar via OUTRO —
// achado A3 da auditoria de abrangência). Todos têm exatamente a mesma
// forma de custo (fixo por tela/matriz/arte + variável por peça +
// substrato da peça em branco + piso do job), então usam 1 função só em vez
// de quadruplicar código quase idêntico — só o ModeloCalculo do produto e a
// MaquinaSetupPorPeca selecionada (filtrada por tipoProcesso na configuração
// do produto) mudam. Sem nesting: não há bobina/folha, mesma filosofia do
// Digital (ver ContextoSetupPorPeca — mesmo papel de
// ContextoDigital.custoSubstratoPorPeca).
export function calcularSetupPorPeca(
  pedido: PedidoSetupPorPeca,
  contexto: ContextoSetupPorPeca,
  params: ParametrosMaquinaSetupPorPeca
): ResultadoSetupPorPeca {
  validarPedidoSetupPorPeca(pedido);

  const Q = pedido.quantidade;

  const custoSetup = paraDecimal(pedido.numeroSetups).times(params.custoPorSetup);
  const custoVariavel = paraDecimal(Q).times(params.custoPorPeca);
  const custoSubstrato = paraDecimal(Q).times(contexto.custoSubstratoPorPeca);
  // Mesma fórmula de piso que acabamento.ts já usa (max contra custoMinimo).
  const custoBase = maiorDec(
    paraDecimal(params.custoMinimo),
    custoSetup.plus(custoVariavel).plus(custoSubstrato)
  );

  return {
    custoSetup,
    custoVariavel,
    custoSubstrato,
    custoBase,
  };
}
