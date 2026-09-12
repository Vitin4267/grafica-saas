import { type Dec, paraDecimal, tetoInteiro, maiorDec } from "./decimal";
import { ErroPrecificacao } from "./erros";
import { validarPedidoOffset } from "./validar";
import { calcularImposicao, type ResultadoImposicao } from "./imposicao";
import type { ContextoOffset, FormatoFolhaInput, ParametrosPrensa, PedidoOffset } from "./tipos";
import type { OrigemPrecoPapel } from "./papel";

// Achado 8 da auditoria do motor M2/Offset (2026-09-12) — antes este objeto
// também tinha `margemLateral: 0.01` e `gapPecas: 0.002`, mas NUNCA eram
// lidos: calcularImposicao (imposicao.ts) sempre resolveu os próprios
// defaults pra esses dois campos (via DEFAULTS_IMPOSICAO), já que o Offset
// nunca precisou de um valor PRÓPRIO pra eles (diferente de `sangria`, usado
// aqui embaixo pra wLinha/hLinha — base do acabamento — e de `pinca`, que
// não existe fisicamente fora de prensa Offset). Removidos por serem código
// morto: editar `DEFAULTS_OFFSET.gapPecas` não mudava nada no nUp real,
// levando quem fosse debugar pro lugar errado.
const DEFAULTS_OFFSET = {
  sangria: 0.003,
  pinca: 0.012,
};

// Achado N4 da auditoria de código (2026-09-04) — calcularImposicao foi
// extraída pra src/lib/pricing/imposicao.ts, já que o motor DIGITAL passou a
// reaproveitar a MESMA geometria (nUp por formato de folha) em vez de
// reimplementar. Reexportada aqui pra não quebrar quem já importava daqui
// (src/lib/pricing/index.ts e testes existentes).
export { calcularImposicao, type ResultadoImposicao } from "./imposicao";

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
  // Achado N12 — puro passthrough de contexto.gramaturaBasePapel/
  // origemPrecoPapel (já resolvidos em resolverPrecoPapel, ver
  // carregarContextoPrecificacao). Nenhum cálculo aqui, só carregam até
  // metricas/breakdown pra UI avisar sobre gramatura aproximada.
  gramaturaBasePapel: number;
  origemPrecoPapel: OrigemPrecoPapel;
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
  nChapas: number;
  custoChapas: Dec;
  custoRodagem: Dec;
  // custoPapel + custoChapas + custoRodagem — custoSetup fica de fora de
  // propósito (achado 5 da auditoria do motor M2/Offset, 2026-09-12): não
  // varia por folha (só de entradas/máquina), então não precisa entrar na
  // comparação, mas é somado de volta em custoBase depois da escolha.
  custoBaseCandidato: Dec;
};

export function calcularOffset(
  pedido: PedidoOffset,
  contexto: ContextoOffset,
  params: ParametrosPrensa
): ResultadoOffset {
  validarPedidoOffset(pedido, contexto, params);

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

  const custoMilheiroRod = paraDecimal(params.custoMilheiroRod);
  const rodagemMinima = paraDecimal(params.rodagemMinima);

  const candidatos: Candidato[] = [];

  for (const folha of contexto.folhas) {
    // Achado N4 — imposicao.ts default de pinca é 0 (motores sem prensa,
    // como o Digital, não têm essa perda física). O Offset precisa continuar
    // resolvendo o PRÓPRIO default (0,012) quando pedido.pinca vier ausente
    // — nunca herdar o 0 do módulo compartilhado, senão nUp fica maior do
    // que a prensa real permite.
    //
    // Achado 8 — mesmo raciocínio pra `sangria`: `sangria` (resolvida acima,
    // linha 90, e já usada em wLinha/hLinha pra base do acabamento) é
    // passada aqui EXPLICITAMENTE, nunca deixando `...pedido` repassar
    // pedido.sangria possivelmente ausente pra calcularImposicao resolver
    // sozinha. Antes da correção, um pedido sem `sangria` explícita fazia
    // este cálculo usar DEFAULTS_OFFSET.sangria (wLinha/hLinha) e
    // calcularImposicao usar DEFAULTS_IMPOSICAO.sangria (nUp/chapas) — dois
    // literais 0,003 em arquivos diferentes, hoje iguais só por coincidência
    // e sem nada garantindo que continuassem. Com o valor resolvido passado
    // explícito, só existe UMA fonte de verdade (DEFAULTS_OFFSET.sangria)
    // pra tudo que o Offset calcula.
    const imposicao = calcularImposicao(
      { ...pedido, sangria: sangria.toNumber(), pinca: pedido.pinca ?? DEFAULTS_OFFSET.pinca },
      folha
    );
    if (!imposicao) continue;

    // Achado 1 da auditoria do motor M2/Offset (2026-09-12) — em
    // work-and-turn (viração), o MESMO jogo de chapas imprime frente e
    // verso da MESMA folha física (a folha passa duas vezes pela prensa,
    // virada na segunda) — então cada folha rende nUp/2 PEÇAS COMPLETAS
    // (frente+verso prontos), não nUp. Mesma condição de elegibilidade do
    // desconto de chapa logo abaixo: F===V (o mesmo jogo de chapas serve
    // aos dois lados) e nUp par (senão não dá pra parear os slots em
    // frente/verso). Sem isso, o motor dava o desconto de chapa mas ainda
    // contava o papel como se o jogo fosse duplo — metade do papel sumia
    // do orçamento (offset.test.ts só cobria viraFolha:false, caminho
    // nunca testado).
    const otimizaViraFolha = contexto.viraFolha && F === V && imposicao.nUp % 2 === 0;
    const nUpPecasCompletas = otimizaViraFolha ? imposicao.nUp / 2 : imposicao.nUp;

    const folhasBoas = Math.ceil(Q / nUpPecasCompletas);
    const folhasPerda = tetoInteiro(paraDecimal(folhasBoas).times(perdaPercent));
    const folhasTotais = folhasBoas + folhasPerda + folhasSetup;

    const pesoFolhaKg = paraDecimal(folha.larguraFolha)
      .times(folha.alturaFolha)
      .times(gramatura)
      .div(1000);
    const custoPapel = paraDecimal(folhasTotais).times(pesoFolhaKg).times(precoKg);

    // work-and-turn: usa o MESMO jogo de chapas nos dois lados — mesma
    // condição de otimizaViraFolha acima (nunca duas condições divergentes
    // pro mesmo fenômeno físico). Com F≠V (ex: 4x1) ou nUp ímpar não aplica
    // a otimização (não é erro, só cobra as chapas cheias — um valor
    // fracionário de chapa seria fisicamente impossível).
    let nChapas = F + V;
    if (otimizaViraFolha) {
      nChapas = nChapas / 2;
    }
    const custoChapas = paraDecimal(nChapas).times(params.custoChapa);

    // Achado N9 (auditoria de abrangência) — cada entrada cobra rodagem
    // sobre a tiragem cheia (folhasBoas + folhasPerda, que se repete em
    // toda entrada, já que cada passada imprime o pedido inteiro) mais o
    // acerto DESSA entrada (folhasAcerto, não folhasSetup — que já é o
    // total do job, params.folhasAcerto × entradas). `entradas ×
    // custoRodagemPorEntrada` soma o acerto uma vez por entrada = linear
    // com o nº de cores/passadas, nunca quadrático.
    const folhasParaRodagemPorEntrada = folhasBoas + folhasPerda + params.folhasAcerto;
    const custoRodagemPorEntrada = maiorDec(
      rodagemMinima,
      paraDecimal(folhasParaRodagemPorEntrada).div(1000).times(custoMilheiroRod)
    );
    const custoRodagem = paraDecimal(entradas).times(custoRodagemPorEntrada);

    candidatos.push({
      folha,
      imposicao,
      folhasBoas,
      folhasPerda,
      folhasSetup,
      folhasTotais,
      custoPapel,
      pesoFolhaKg,
      nChapas,
      custoChapas,
      custoRodagem,
      custoBaseCandidato: custoPapel.plus(custoChapas).plus(custoRodagem),
    });
  }

  if (candidatos.length === 0) {
    throw new ErroPrecificacao(
      "PECA_EXCEDE_FOLHA",
      "Essa peça não cabe em nenhum formato de folha cadastrado para este papel.",
      { larguraM: pedido.larguraM, alturaM: pedido.alturaM }
    );
  }

  // Achado 5 da auditoria do motor M2/Offset (2026-09-12) — a folha mais
  // barata em PAPEL nem sempre é a mais barata no TOTAL: o nUp da folha
  // decide se o desconto de work-and-turn vale (otimizaViraFolha acima) e
  // quantas folhas a rodagem cobra por entrada — uma folha alguns reais
  // mais barata em papel, mas com nUp ímpar (sem desconto de chapa), pode
  // sair centenas de reais mais cara no total. Escolhe pelo custo-base
  // completo (papel + chapas + rodagem) de cada candidato, não só papel.
  const escolhido = candidatos.reduce((melhor, atual) =>
    atual.custoBaseCandidato.lt(melhor.custoBaseCandidato) ? atual : melhor
  );

  const custoSetup = paraDecimal(entradas).times(params.tempoAcertoH).times(params.custoHoraMaq);

  const custoBase = escolhido.custoBaseCandidato.plus(custoSetup);
  const pesoTotalPedidoKg = paraDecimal(escolhido.folhasTotais).times(escolhido.pesoFolhaKg);

  return {
    nUp: escolhido.imposicao.nUp,
    rotacionado: escolhido.imposicao.rotacionado,
    entradas,
    folhasBoas: escolhido.folhasBoas,
    folhasPerda: escolhido.folhasPerda,
    folhasSetup: escolhido.folhasSetup,
    folhasTotais: escolhido.folhasTotais,
    nChapas: escolhido.nChapas,
    custoPapel: escolhido.custoPapel,
    custoChapas: escolhido.custoChapas,
    custoRodagem: escolhido.custoRodagem,
    custoSetup,
    custoBase,
    pesoTotalPedidoKg,
    folhaEscolhida: { id: escolhido.folha.id, nome: escolhido.folha.nome },
    larguraEfetivaM: wLinha,
    alturaEfetivaM: hLinha,
    // Ausentes (fixtures de teste que montam ContextoOffset à mão, ver tipos.ts)
    // = "EXATO" e a própria gramatura escolhida, equivalente a resolverPrecoPapel
    // quando a gramatura bate exatamente — nenhum aviso falso.
    gramaturaBasePapel: contexto.gramaturaBasePapel ?? contexto.gramaturaGm2,
    origemPrecoPapel: contexto.origemPrecoPapel ?? "EXATO",
  };
}
