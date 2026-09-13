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
  metragemBoa: Dec;
  metragemPerda: Dec;
  metragemTotal: Dec;
  custoMaterial: Dec;
  custoRodagem: Dec;
  // Achado A2 da auditoria do motor de preço (2026-09-13) — mesmo campo
  // que offset.ts já usa (custoBaseCandidato), pelo mesmo motivo: a bobina
  // mais barata em MATERIAL nem sempre é a mais barata no TOTAL, porque a
  // bobina escolhida também fixa nUp → numRevolucoes → metragemBoa, a base
  // da rodagem (R$/metro linear, indiferente à largura) — minimizar só o
  // material favorece sistematicamente a bobina estreita, que roda muito
  // mais metro. Escolhido pelo custo-base completo (material + rodagem).
  custoBaseCandidato: Dec;
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
  validarPedidoFlexografia(pedido, contexto, params);

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

    // Achado N9 (auditoria de abrangência) — mesmo bug do Offset (ver
    // comentário espelho em offset.ts): ANTES, `metragemTotal` (=
    // metragemBoa + metragemPerda + metragemSetup) já continha
    // metragemSetup = metrosAcerto × entradas, o total de acerto do job
    // inteiro (linha ~69 acima). `custoRodagem = entradas ×
    // custoRodagemPorEntrada` logo abaixo multiplicava esse total por
    // entradas DE NOVO — a parcela de acerto escalava com entradas² em vez
    // de entradas. DEPOIS: cada entrada cobra rodagem sobre a metragem
    // cheia (metragemBoa + metragemPerda, repetida em toda entrada) mais o
    // acerto DESSA entrada (metrosAcerto, não metragemSetup) — `entradas ×
    // custoRodagemPorEntrada` soma o acerto uma vez por entrada =
    // metrosAcerto × entradas no total, linear. O consumo FÍSICO de
    // material (custoMaterial, metragemLinearM) continua usando
    // metragemTotal (com metragemSetup) sem mudança — só a rodagem mudou.
    //
    // Achado A2 (2026-09-13) — calculado AQUI DENTRO do loop, por
    // candidato (não só depois de escolher), porque é exatamente essa
    // rodagem que decide qual bobina é mais barata no total — ver
    // custoBaseCandidato abaixo.
    const metragemParaRodagemPorEntrada = metragemBoa.plus(metragemPerda).plus(params.metrosAcerto);
    const custoRodagemPorEntrada = maiorDec(
      paraDecimal(params.rodagemMinima),
      metragemParaRodagemPorEntrada.times(params.custoMetroLinearRod)
    );
    const custoRodagem = paraDecimal(entradas).times(custoRodagemPorEntrada);

    candidatos.push({
      bobina,
      nUp,
      numRevolucoes,
      metragemBoa,
      metragemPerda,
      metragemTotal,
      custoMaterial,
      custoRodagem,
      custoBaseCandidato: custoMaterial.plus(custoRodagem),
    });
  }

  if (candidatos.length === 0) {
    throw new ErroPrecificacao(
      "PECA_EXCEDE_BOBINA",
      "Essa peça é mais larga que a largura útil de todas as bobinas cadastradas para este material (considerando o limite de largura da máquina escolhida). É necessário outra bobina ou máquina — intervenção manual necessária.",
      { larguraM: pedido.larguraM, alturaM: pedido.alturaM }
    );
  }

  // Achado A2 da auditoria do motor de preço (2026-09-13, gêmeo do achado 5
  // da auditoria M2/Offset já corrigido em offset.ts) — escolhe pelo
  // custo-base completo (material + rodagem) de cada candidato, não só
  // material: a bobina mais barata em material pode custar centenas de
  // reais a mais no total, porque a rodagem (R$/metro linear) é indiferente
  // à largura e escala com o nº de revoluções, que a bobina também decide.
  const escolhido = candidatos.reduce((melhor, atual) =>
    atual.custoBaseCandidato.lt(melhor.custoBaseCandidato) ? atual : melhor
  );

  const custoSetup = paraDecimal(entradas).times(params.tempoAcertoH).times(params.custoHoraMaq);
  const custoBase = escolhido.custoBaseCandidato.plus(custoSetup);

  return {
    nUp: escolhido.nUp,
    entradas,
    numRevolucoes: escolhido.numRevolucoes,
    metragemLinearM: escolhido.metragemTotal,
    custoMaterial: escolhido.custoMaterial,
    custoRodagem: escolhido.custoRodagem,
    custoSetup,
    custoBase,
    bobinaEscolhida: { id: escolhido.bobina.id, larguraNominal: escolhido.bobina.larguraNominal },
    larguraEfetivaM,
    alturaEfetivaM,
  };
}
