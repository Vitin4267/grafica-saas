import { type Dec, paraDecimal, maiorDec } from "./decimal";
import { validarPedidoBordado, validarParametrosMaquinaBordado } from "./validar";
import type { ContextoBordado, ParametrosMaquinaBordado, PedidoBordado } from "./tipos";

export type ResultadoBordado = {
  custoMatriz: Dec;
  custoPontos: Dec;
  custoSubstrato: Dec;
  custoMaquina: Dec;
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
//
// Achado B1 da auditoria do motor de preço (2026-09-13): params.custoHoraMaq
// (R$/h, opcional) ANTES era gravado, validado e prometido na tela ("separe
// o custo de hora-máquina do custo por ponto") mas nunca chegava aqui —
// carregarParametrosMaquinaBordado descartava o campo. Um dono que seguia o
// hint da tela e preenchia só custoHoraMaq (deixando custoPorMilPontos baixo
// de propósito) tinha o custo de hora-máquina silenciosamente zerado.
// Agora: se custoHoraMaq está presente, também precisa de
// velocidadePontosPorMinuto (pontos/min da máquina) pra saber QUANTO TEMPO o
// pedido consome — minutos = (numeroPontos × Q) ÷ velocidade. cabecas
// continua fora da fórmula (documentado como informativo no schema).
export function calcularBordado(
  pedido: PedidoBordado,
  contexto: ContextoBordado,
  params: ParametrosMaquinaBordado
): ResultadoBordado {
  validarPedidoBordado(pedido, contexto);
  validarParametrosMaquinaBordado(params);

  const Q = pedido.quantidade;

  const custoMatriz = paraDecimal(params.custoMatrizDigitalizacao);
  const custoPontos = paraDecimal(pedido.numeroPontos)
    .dividedBy(1000)
    .times(params.custoPorMilPontos);
  const custoPontosTotal = custoPontos.times(Q);
  const custoSubstrato = paraDecimal(Q).times(contexto.custoSubstratoPorPeca);

  let custoMaquina = paraDecimal(0);
  if (params.custoHoraMaq !== undefined) {
    const minutosTotal = paraDecimal(pedido.numeroPontos)
      .times(Q)
      .dividedBy(params.velocidadePontosPorMinuto!);
    custoMaquina = minutosTotal.dividedBy(60).times(params.custoHoraMaq);
  }

  // Achado B4 da auditoria do motor de preço (2026-09-13) — custoMinimo é o
  // piso do SERVIÇO (a tela do cadastro diz "se setup + variável ficar
  // abaixo disso, cobra este valor" — nunca menciona a peça em branco).
  // ANTES, o max() comparava o piso contra o total JÁ SOMADO com
  // custoSubstrato: numa peça cara (ex: camiseta premium), o substrato
  // sozinho já empurrava o total acima do piso, e o piso nunca entrava —
  // uma gráfica configurando "mínimo R$120 pra ligar a máquina" cobrava só
  // R$50 de serviço numa peça de R$125, porque 125+50=175 > 120 "passava"
  // sem o piso nunca proteger o SERVIÇO em si. Agora o max() só olha o
  // serviço (matriz+pontos+máquina); o substrato entra DEPOIS, sempre
  // 100% cobrado, nunca "absorvido" pelo piso.
  const custoServico = custoMatriz.plus(custoPontosTotal).plus(custoMaquina);
  const custoBase = maiorDec(paraDecimal(params.custoMinimo), custoServico).plus(custoSubstrato);

  return {
    custoMatriz,
    custoPontos: custoPontosTotal,
    custoSubstrato,
    custoMaquina,
    custoBase,
  };
}
