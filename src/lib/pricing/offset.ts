import { type Dec, paraDecimal, tetoInteiro, maiorDec } from "./decimal";
import { ErroPrecificacao } from "./erros";
import { validarPedidoOffset } from "./validar";
import type { ContextoOffset, FormatoFolhaInput, ParametrosPrensa, PedidoOffset } from "./tipos";

const DEFAULTS_OFFSET = {
  sangria: 0.003,
  pinca: 0.012,
  margemLateral: 0.01,
  gapPecas: 0.002,
};

export type ResultadoImposicao = { nUp: number; rotacionado: boolean };

// Retorna null quando nUp=0 (peça não cabe nesse formato de folha em nenhuma orientação).
export function calcularImposicao(
  pedido: PedidoOffset,
  folha: FormatoFolhaInput
): ResultadoImposicao | null {
  const sangria = paraDecimal(pedido.sangria ?? DEFAULTS_OFFSET.sangria);
  const pinca = paraDecimal(pedido.pinca ?? DEFAULTS_OFFSET.pinca);
  const mLat = paraDecimal(pedido.margemLateral ?? DEFAULTS_OFFSET.margemLateral);
  const g = paraDecimal(pedido.gapPecas ?? DEFAULTS_OFFSET.gapPecas);

  const wLinha = paraDecimal(pedido.larguraM).plus(sangria.times(2));
  const hLinha = paraDecimal(pedido.alturaM).plus(sangria.times(2));

  const lF = paraDecimal(folha.larguraFolha);
  const aF = paraDecimal(folha.alturaFolha);
  const lu = lF.minus(pinca).minus(mLat.times(2));
  const au = aF.minus(mLat.times(2));

  const normal = lu
    .plus(g)
    .div(wLinha.plus(g))
    .floor()
    .times(au.plus(g).div(hLinha.plus(g)).floor())
    .toNumber();
  const rotacionada = lu
    .plus(g)
    .div(hLinha.plus(g))
    .floor()
    .times(au.plus(g).div(wLinha.plus(g)).floor())
    .toNumber();

  const nUp = Math.max(normal, rotacionada);
  if (nUp <= 0) return null;

  return { nUp, rotacionado: rotacionada > normal };
}

export type ResultadoOffset = {
  nUp: number;
  rotacionado: boolean;
  entradas: number;
  folhasBoas: number;
  folhasPerda: number;
  folhasSetup: number;
  folhasTotais: number;
  nChapas: number;
  custoPapel: Dec;
  custoChapas: Dec;
  custoRodagem: Dec;
  custoSetup: Dec;
  custoBase: Dec; // NÃO é o custoDireto final (ver compor.ts)
  pesoTotalPedidoKg: Dec;
  folhaEscolhida: { id: string; nome: string };
  larguraEfetivaM: Dec; // w'' — reaproveitado pelo cálculo de acabamento (base M2, se aplicável)
  alturaEfetivaM: Dec; // h''
};

type Candidato = {
  folha: FormatoFolhaInput;
  imposicao: ResultadoImposicao;
  folhasBoas: number;
  folhasPerda: number;
  folhasSetup: number;
  folhasTotais: number;
  custoPapel: Dec;
  pesoFolhaKg: Dec;
};

export function calcularOffset(
  pedido: PedidoOffset,
  contexto: ContextoOffset,
  params: ParametrosPrensa
): ResultadoOffset {
  validarPedidoOffset(pedido, contexto);

  const Q = pedido.quantidade;
  const F = pedido.corFrente;
  const V = pedido.corVerso;
  const entradas = Math.ceil(F / params.torres) + (V > 0 ? Math.ceil(V / params.torres) : 0);
  const perdaPercent = paraDecimal(pedido.perdaPercent ?? params.perdaPercentPadrao);
  const folhasSetup = params.folhasAcerto * entradas;
  const gramatura = paraDecimal(contexto.gramaturaGm2);
  const precoKg = paraDecimal(contexto.precoPorKg);

  const sangria = paraDecimal(pedido.sangria ?? DEFAULTS_OFFSET.sangria);
  const wLinha = paraDecimal(pedido.larguraM).plus(sangria.times(2));
  const hLinha = paraDecimal(pedido.alturaM).plus(sangria.times(2));

  const candidatos: Candidato[] = [];

  for (const folha of contexto.folhas) {
    const imposicao = calcularImposicao(pedido, folha);
    if (!imposicao) continue;

    const folhasBoas = Math.ceil(Q / imposicao.nUp);
    const folhasPerda = tetoInteiro(paraDecimal(folhasBoas).times(perdaPercent));
    const folhasTotais = folhasBoas + folhasPerda + folhasSetup;

    const pesoFolhaKg = paraDecimal(folha.larguraFolha)
      .times(folha.alturaFolha)
      .times(gramatura)
      .div(1000);
    const custoPapel = paraDecimal(folhasTotais).times(pesoFolhaKg).times(precoKg);

    candidatos.push({
      folha,
      imposicao,
      folhasBoas,
      folhasPerda,
      folhasSetup,
      folhasTotais,
      custoPapel,
      pesoFolhaKg,
    });
  }

  if (candidatos.length === 0) {
    throw new ErroPrecificacao(
      "PECA_EXCEDE_FOLHA",
      "Essa peça não cabe em nenhum formato de folha cadastrado para este papel.",
      { larguraM: pedido.larguraM, alturaM: pedido.alturaM }
    );
  }

  const escolhido = candidatos.reduce((melhor, atual) =>
    atual.custoPapel.lt(melhor.custoPapel) ? atual : melhor
  );

  let nChapas = F + V;
  // work-and-turn: usa o MESMO jogo de chapas nos dois lados, então só faz
  // sentido (e só resulta em nº inteiro de chapas) quando frente e verso têm o
  // mesmo nº de cores — F === V. Antes reduzia pela metade sempre que nUp era
  // par, ignorando a simetria: com F≠V (ex: 4x1) e nUp par dava (4+1)/2 = 2,5
  // chapas, um valor fisicamente impossível que subestimava o custo. Com F≠V
  // não aplica a otimização (não é erro, só cobra as chapas cheias).
  if (contexto.viraFolha && F === V && escolhido.imposicao.nUp % 2 === 0) {
    nChapas = nChapas / 2;
  }
  const custoChapas = paraDecimal(nChapas).times(params.custoChapa);

  const custoMilheiroRod = paraDecimal(params.custoMilheiroRod);
  const rodagemMinima = paraDecimal(params.rodagemMinima);
  const custoRodagemPorEntrada = maiorDec(
    rodagemMinima,
    paraDecimal(escolhido.folhasTotais).div(1000).times(custoMilheiroRod)
  );
  const custoRodagem = paraDecimal(entradas).times(custoRodagemPorEntrada);

  const custoSetup = paraDecimal(entradas).times(params.tempoAcertoH).times(params.custoHoraMaq);

  const custoBase = escolhido.custoPapel.plus(custoChapas).plus(custoRodagem).plus(custoSetup);
  const pesoTotalPedidoKg = paraDecimal(escolhido.folhasTotais).times(escolhido.pesoFolhaKg);

  return {
    nUp: escolhido.imposicao.nUp,
    rotacionado: escolhido.imposicao.rotacionado,
    entradas,
    folhasBoas: escolhido.folhasBoas,
    folhasPerda: escolhido.folhasPerda,
    folhasSetup: escolhido.folhasSetup,
    folhasTotais: escolhido.folhasTotais,
    nChapas,
    custoPapel: escolhido.custoPapel,
    custoChapas,
    custoRodagem,
    custoSetup,
    custoBase,
    pesoTotalPedidoKg,
    folhaEscolhida: { id: escolhido.folha.id, nome: escolhido.folha.nome },
    larguraEfetivaM: wLinha,
    alturaEfetivaM: hLinha,
  };
}
