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
  validarPedidoSetupPorPeca(pedido, contexto);

  const Q = pedido.quantidade;

  const custoSetup = paraDecimal(pedido.numeroSetups).times(params.custoPorSetup);
  const custoVariavel = paraDecimal(Q).times(params.custoPorPeca);
  const custoSubstrato = paraDecimal(Q).times(contexto.custoSubstratoPorPeca);
  // Achado B4 da auditoria do motor de preço (2026-09-13) — custoMinimo é o
  // piso do SERVIÇO ("Piso — se setup + variável ficar abaixo disso, cobra
  // este valor", texto da própria tela de cadastro da máquina). ANTES, o
  // max() comparava o piso contra setup+variável+SUBSTRATO: numa peça cara
  // (ex: camiseta premium R$25 × 5un = R$125 de substrato), o substrato
  // sozinho já empurrava o total acima do piso e o piso nunca protegia o
  // SERVIÇO em si — uma gráfica com "mínimo R$120 pra ligar a máquina"
  // cobrava só R$50 de serviço (setup R$40 + variável R$10), porque
  // 125+50=175 > 120 "passava" sem o piso nunca agir. Agora o max() só olha
  // o serviço; o substrato entra DEPOIS, sempre 100% cobrado, nunca
  // "absorvido" pelo piso.
  const custoServico = custoSetup.plus(custoVariavel);
  const custoBase = maiorDec(paraDecimal(params.custoMinimo), custoServico).plus(custoSubstrato);

  return {
    custoSetup,
    custoVariavel,
    custoSubstrato,
    custoBase,
  };
}
