import { type Dec, paraDecimal } from "./decimal";
import { ErroPrecificacao } from "./erros";
import { validarPedidoDigital } from "./validar";
import { calcularImposicao, type ResultadoImposicao } from "./imposicao";
import type { ContextoDigital, FormatoFolhaInput, ParametrosImpressoraDigital, PedidoDigital } from "./tipos";

export type ResultadoDigital = {
  nUp: number;
  rotacionado: boolean;
  // Nº de folhas físicas necessárias — Math.ceil(Q / nUp), mesmo cálculo que
  // o Offset já faz em folhasBoas (ver offset.ts). É o número que a gráfica
  // rápida realmente confere na hora de cortar (ex: ~42 folhas pra 1000
  // cartões 24-up, achado N4).
  numeroFolhas: number;
  // Cliques POR FOLHA (não o total) — default 1, ou o override manual do
  // pedido. O total de cliques físicos da impressora é numeroFolhas ×
  // numeroCliques (embutido em custoCliques abaixo).
  numeroCliques: number;
  custoCliques: Dec;
  custoSubstrato: Dec;
  custoBase: Dec;
  folhaEscolhida: { id: string; nome: string };
};

// Achado N4 da auditoria de código (2026-09-04) — impressão digital agora faz
// IMPOSIÇÃO igual ao Offset: lê os FormatoFolha do papel escolhido no
// orçamento (contexto.folhas), calcula quantas peças cabem por folha (nUp,
// reaproveitando a mesma geometria de src/lib/pricing/imposicao.ts) e deriva
// numeroFolhas = ceil(Q / nUp). Substrato e clique passam a ser cobrados POR
// FOLHA, não mais por peça — antes (Q × custoPorClique + Q ×
// custoSubstratoPorPeca) superfaturava em até Nx quando N peças cabiam na
// mesma folha (ex: 1000 cartões 24-up cobravam como 1000 cliques/folhas, o
// real é ~42).
//
// Diferente do Offset (que escolhe a folha de MENOR custoPapel, já que o
// peso/preço por kg varia com o formato), aqui custoPorFolha é FIXO por
// papel — então maximizar nUp já minimiza direto o número de folhas e,
// portanto, o custo total. Por isso o critério de escolha é "maior nUp", não
// "menor custo".
//
// pinca (margem de garra da prensa offset) não existe fisicamente numa
// impressora digital — chamamos calcularImposicao sempre com pinca=0,
// nunca com o default 0.012 do Offset (ver comentário em imposicao.ts).
export function calcularDigital(
  pedido: PedidoDigital,
  contexto: ContextoDigital,
  params: ParametrosImpressoraDigital
): ResultadoDigital {
  validarPedidoDigital(pedido, contexto);

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
      "Essa peça não cabe em nenhum formato de folha cadastrado para o papel escolhido.",
      { larguraM: pedido.larguraM, alturaM: pedido.alturaM }
    );
  }

  const numeroFolhas = Math.ceil(Q / melhor.imposicao.nUp);
  const numeroCliques = pedido.numeroCliques ?? 1;

  const custoCliques = paraDecimal(numeroFolhas).times(numeroCliques).times(params.custoPorClique);
  const custoSubstrato = paraDecimal(numeroFolhas).times(contexto.custoPorFolha);
  const custoBase = custoCliques.plus(custoSubstrato);

  return {
    nUp: melhor.imposicao.nUp,
    rotacionado: melhor.imposicao.rotacionado,
    numeroFolhas,
    numeroCliques,
    custoCliques,
    custoSubstrato,
    custoBase,
    folhaEscolhida: { id: melhor.folha.id, nome: melhor.folha.nome },
  };
}
