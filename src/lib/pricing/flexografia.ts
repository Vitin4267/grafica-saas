import { type Dec, paraDecimal, maiorDec, menorDec } from "./decimal";
import { ErroPrecificacao } from "./erros";
import { validarPedidoFlexografia } from "./validar";
import type {
  Bobina,
  ContextoFlexografia,
  ParametrosMaquinaFlexo,
  PedidoFlexografia,
} from "./tipos";

const DEFAULTS_FLEXOGRAFIA = {
  margemSegurancaPadrao: 0.02,
  gapPecasPadrao: 0.008,
};

export type ResultadoFlexografia = {
  nUp: number;
  entradas: number;
  numRevolucoes: number;
  metragemLinearM: Dec;
  custoMaterial: Dec;
  custoRodagem: Dec;
  custoSetup: Dec;
  custoBase: Dec; // NÃO inclui clichê — somado depois em precificar.ts
  bobinaEscolhida: { id: string; larguraNominal: number };
  larguraEfetivaM: Dec; // w' — reaproveitado pelo cálculo de acabamento
  alturaEfetivaM: Dec; // h'
};

type Candidato = {
  bobina: Bobina;
  nUp: number;
  numRevolucoes: number;
  metragemTotal: Dec;
  custoMaterial: Dec;
};

// Nesting 1D (largura da bobina) — diferente do 2D do Offset: a bobina roda
// contínua, então só a largura precisa caber lado a lado; o comprimento é o
// passo do cilindro, fixo por volta (v1 não suporta múltiplos repeats).
export function calcularFlexografia(
  pedido: PedidoFlexografia,
  contexto: ContextoFlexografia,
  params: ParametrosMaquinaFlexo,
  defaults: { margemSegurancaPadrao: number; gapPecasPadrao: number } = DEFAULTS_FLEXOGRAFIA
): ResultadoFlexografia {
  validarPedidoFlexografia(pedido, contexto);

  const Q = pedido.quantidade;
  const s = paraDecimal(pedido.margemSeguranca ?? defaults.margemSegurancaPadrao);
  const g = paraDecimal(pedido.gapPecas ?? defaults.gapPecasPadrao);

  const larguraEfetivaM = paraDecimal(pedido.larguraM).plus(s.times(2));
  const alturaEfetivaM = paraDecimal(pedido.alturaM).plus(s.times(2));

  const passoCilindroM = paraDecimal(params.passoCilindroM);
  if (alturaEfetivaM.gt(passoCilindroM)) {
    throw new ErroPrecificacao(
      "PECA_EXCEDE_BOBINA",
      "A altura da peça excede o passo do cilindro desta máquina.",
      { alturaEfetivaM: alturaEfetivaM.toNumber(), passoCilindroM: params.passoCilindroM }
    );
  }

  const entradas = Math.ceil(pedido.numeroCores / params.numeroEstacoesCores);
  const perdaPercent = paraDecimal(pedido.perdaPercent ?? params.perdaPercentPadrao);
  const custoM2Material = paraDecimal(contexto.custoM2Material);
  const larguraMaquinaM = paraDecimal(params.larguraMaquinaM);
  const metragemSetup = paraDecimal(params.metrosAcerto).times(entradas);

  const candidatos: Candidato[] = [];

  for (const bobina of contexto.bobinas) {
    const larguraNominal = paraDecimal(bobina.larguraNominal);
    const refile = paraDecimal(bobina.refile);
    const wUtilEfetiva = menorDec(larguraNominal.minus(refile.times(2)), larguraMaquinaM);

    const nUp = wUtilEfetiva.plus(g).div(larguraEfetivaM.plus(g)).floor().toNumber();
    if (nUp <= 0) continue; // peça não cabe na largura útil desta bobina/máquina

    const numRevolucoes = Math.ceil(Q / nUp);
    const metragemBoa = paraDecimal(numRevolucoes).times(passoCilindroM);
    const metragemPerda = metragemBoa.times(perdaPercent);
    const metragemTotal = metragemBoa.plus(metragemPerda).plus(metragemSetup);
    const custoMaterial = metragemTotal.times(larguraNominal).times(custoM2Material);

    candidatos.push({ bobina, nUp, numRevolucoes, metragemTotal, custoMaterial });
  }

  if (candidatos.length === 0) {
    throw new ErroPrecificacao(
      "PECA_EXCEDE_BOBINA",
      "Essa peça é mais larga que a largura útil de todas as bobinas cadastradas para este material (considerando o limite de largura da máquina escolhida). É necessário outra bobina ou máquina — intervenção manual necessária.",
      { larguraM: pedido.larguraM, alturaM: pedido.alturaM }
    );
  }

  const escolhido = candidatos.reduce((melhor, atual) =>
    atual.custoMaterial.lt(melhor.custoMaterial) ? atual : melhor
  );

  const custoRodagemPorEntrada = maiorDec(
    paraDecimal(params.rodagemMinima),
    escolhido.metragemTotal.times(params.custoMetroLinearRod)
  );
  const custoRodagem = paraDecimal(entradas).times(custoRodagemPorEntrada);
  const custoSetup = paraDecimal(entradas).times(params.tempoAcertoH).times(params.custoHoraMaq);
  const custoBase = escolhido.custoMaterial.plus(custoRodagem).plus(custoSetup);

  return {
    nUp: escolhido.nUp,
    entradas,
    numRevolucoes: escolhido.numRevolucoes,
    metragemLinearM: escolhido.metragemTotal,
    custoMaterial: escolhido.custoMaterial,
    custoRodagem,
    custoSetup,
    custoBase,
    bobinaEscolhida: { id: escolhido.bobina.id, larguraNominal: escolhido.bobina.larguraNominal },
    larguraEfetivaM,
    alturaEfetivaM,
  };
}
