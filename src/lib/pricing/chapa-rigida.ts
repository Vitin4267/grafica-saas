import { type Dec, paraDecimal } from "./decimal";
import { ErroPrecificacao } from "./erros";
import { validarPedidoChapaRigida } from "./validar";
import { calcularImposicao, DEFAULTS_IMPOSICAO, type ResultadoImposicao } from "./imposicao";
import { calcularTempoMaquina } from "./tempo-maquina";
import type {
  ContextoChapaRigida,
  FormatoFolhaInput,
  ParametrosMaquinaTempo,
  PedidoChapaRigida,
} from "./tipos";

export type ResultadoChapaRigida = {
  nUp: number;
  rotacionado: boolean;
  // Numero de chapas fisicas necessarias -- Math.ceil(Q / nUp), mesmo
  // calculo que numeroFolhas do Digital (ver digital.ts).
  nChapas: number;
  custoChapas: Dec;
  custoImpressao: Dec;
  // 0 quando o produto nao tem maquinaTempoId configurado OU quando o
  // pedido nao informou tempoEstimadoMin/metrosCorte -- corte e OPCIONAL
  // (ver comentario de PedidoChapaRigida em tipos.ts).
  custoCorte: Dec;
  custoBase: Dec; // NAO e o custoDireto final (ver compor.ts)
  folhaEscolhida: { id: string; nome: string };
};

// Achado A7 da auditoria de abrangencia (pesquisa-abrangencia-modulos.md,
// "Nao existe nesting em CHAPA RIGIDA", 2026-09-09): PVC, ACM, acrilico,
// MDF, papelao Parana sao vendidos em chapa fechada (ex: 1220x2440) e nao
// tinham como calcular quantas pecas saem de uma chapa -- a unica opcao era
// SIMPLES (custo zero, sem motor nenhum).
//
// Reaproveita a MESMA geometria de imposicao 2D do Offset/Digital
// (calcularImposicao, src/lib/pricing/imposicao.ts) sobre FormatoFolha do
// PRODUTO (mesma relacao ja usada pelo Offset, so passa a ser lida tambem
// pra este modelo -- ver carregarContextoPrecificacao). Igual ao Digital
// (nao ao Offset): o preco por chapa e FIXO (nao varia por peso/gramatura),
// entao maximizar nUp ja minimiza direto o numero de chapas e, portanto, o
// custo total -- o criterio de escolha e "maior nUp", nao "menor custo".
//
// pinca (margem de garra de prensa OFFSET) nao existe fisicamente numa
// chapa rigida cortada -- chamamos calcularImposicao sempre com pinca=0,
// nunca com o default do Offset (mesmo motivo do Digital, ver
// imposicao.ts).
//
// Corte (achado A6, MaquinaTempo) e OPCIONAL e desacoplado deste motor: o
// chamador (precificar.ts) so passa parametrosMaquinaTempo quando o produto
// tem maquinaTempoId configurado, e mesmo assim so entra no custo quando o
// PEDIDO informou tempoEstimadoMin e/ou metrosCorte -- um produto CHAPA_
// RIGIDA sem corte configurado (so impressao, ex: adesivo em ACM ja cortado
// por fora) nunca paga custoCorte.
export function calcularChapaRigida(
  pedido: PedidoChapaRigida,
  contexto: ContextoChapaRigida,
  parametrosMaquinaTempo?: ParametrosMaquinaTempo
): ResultadoChapaRigida {
  validarPedidoChapaRigida(pedido, contexto);

  const Q = pedido.quantidade;

  let melhor: { folha: FormatoFolhaInput; imposicao: ResultadoImposicao } | null = null;
  for (const folha of contexto.folhas) {
    const imposicao = calcularImposicao(
      {
        larguraM: pedido.larguraM,
        alturaM: pedido.alturaM,
        sangria: pedido.sangria,
        margemLateral: pedido.margemLateral,
        gapPecas: pedido.gapPecas,
        pinca: 0,
      },
      folha
    );
    if (!imposicao) continue;
    if (!melhor || imposicao.nUp > melhor.imposicao.nUp) {
      melhor = { folha, imposicao };
    }
  }

  if (!melhor) {
    throw new ErroPrecificacao(
      "PECA_EXCEDE_FOLHA",
      "Essa peça não cabe em nenhum formato de chapa cadastrado para este produto.",
      { larguraM: pedido.larguraM, alturaM: pedido.alturaM }
    );
  }

  const nChapas = Math.ceil(Q / melhor.imposicao.nUp);
  const custoChapas = paraDecimal(nChapas).times(contexto.precoPorChapa);

  // Area da PECA (com sangria, mesma base que o resto do motor usa pra
  // "quanto realmente sai impresso") x Q x R$/m2 -- mesma formula de
  // custoImpressao do M2 (ver m2.ts), mas SEM areaMinimaFaturavel (achado
  // A7 nao pede piso comercial por peca pra este modelo; se um dia precisar,
  // e o mesmo padrao de ItemGrafica.areaMinimaFaturavel do M2).
  const sangria = paraDecimal(pedido.sangria ?? DEFAULTS_IMPOSICAO.sangria);
  const larguraComSangria = paraDecimal(pedido.larguraM).plus(sangria.times(2));
  const alturaComSangria = paraDecimal(pedido.alturaM).plus(sangria.times(2));
  const areaPecaComSangria = larguraComSangria.times(alturaComSangria);
  const custoImpressao = paraDecimal(Q).times(areaPecaComSangria).times(contexto.custoImpressaoM2);

  let custoCorte = paraDecimal(0);
  if (
    parametrosMaquinaTempo &&
    (pedido.tempoEstimadoMin !== undefined || pedido.metrosCorte !== undefined)
  ) {
    custoCorte = calcularTempoMaquina(
      {
        quantidade: Q,
        tempoEstimadoMin: pedido.tempoEstimadoMin,
        metrosCorte: pedido.metrosCorte,
      },
      parametrosMaquinaTempo
    ).custoBase;
  }

  const custoBase = custoChapas.plus(custoImpressao).plus(custoCorte);

  return {
    nUp: melhor.imposicao.nUp,
    rotacionado: melhor.imposicao.rotacionado,
    nChapas,
    custoChapas,
    custoImpressao,
    custoCorte,
    custoBase,
    folhaEscolhida: { id: melhor.folha.id, nome: melhor.folha.nome },
  };
}
