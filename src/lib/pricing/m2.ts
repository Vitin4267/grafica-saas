import { type Dec, paraDecimal, maiorDec, tetoInteiro } from "./decimal";
import { ErroPrecificacao } from "./erros";
import { validarPedidoM2 } from "./validar";
import type { Bobina, ContextoM2, PedidoM2 } from "./tipos";

export type ResultadoM2 = {
  custoMaterial: Dec;
  custoImpressao: Dec;
  custoBase: Dec; // custoMaterial + custoImpressao (+ custoEmenda, quando aplicável) — NÃO é o custoDireto final (ver compor.ts)
  areaFaturavel: Dec;
  // Achado N18 — métrica de EXIBIÇÃO (área nominal w×h do pedido vs.
  // areaMinimaFaturavel, sem margem de segurança), continua sem realimentar
  // o nesting/custoMaterial. O PISO em si agora afeta o preço por outro
  // caminho: custoImpressao usa areaImpressaoPorPeca (com margem de
  // segurança), floored pela mesma areaMinimaFaturavel — ver abaixo. As duas
  // bases (com/sem margem) divergem de propósito: areaCobrada mostra o que
  // o cliente pediu vs. o mínimo comercial; custoImpressao precisa da área
  // real que entra na máquina.
  areaCobrada: Dec;
  eficiencia: Dec;
  bobinaEscolhida: { id: string; larguraNominal: number; rotacionado: boolean };
  pecasPorFaixa: number;
  numFaixas: number;
  larguraEfetivaM: Dec; // w' — reaproveitado pelo cálculo de acabamento (base M2)
  alturaEfetivaM: Dec; // h'
  // Achado A9 — presentes só quando a peça excedeu toda bobina cadastrada E
  // o item tem ConfiguracaoEmenda: nºPainéis em que a peça foi dividida e o
  // custo de emenda somado (já incluso em custoBase). undefined/0 em
  // qualquer outro caso (comportamento de hoje, sem emenda).
  numPaineis?: number;
  custoEmenda: Dec;
  avisos: string[];
};

type Candidato = {
  bobina: Bobina;
  rotacionado: boolean;
  pecasPorFaixa: number;
  numFaixas: number;
  areaFaturavel: Dec;
  custoMaterial: Dec;
};

const DEFAULTS_M2 = {
  margemSegurancaPadrao: 0.02,
  gapPecasPadrao: 0.008,
};

export function calcularM2(
  pedido: PedidoM2,
  contexto: ContextoM2,
  defaults: { margemSegurancaPadrao: number; gapPecasPadrao: number } = DEFAULTS_M2
): ResultadoM2 {
  validarPedidoM2(pedido, contexto);

  const s = paraDecimal(pedido.margemSeguranca ?? defaults.margemSegurancaPadrao);
  const g = paraDecimal(pedido.gapPecas ?? defaults.gapPecasPadrao);
  const Q = pedido.quantidade;

  const w = paraDecimal(pedido.larguraM);
  const h = paraDecimal(pedido.alturaM);
  const wLinha = w.plus(s.times(2));
  const hLinha = h.plus(s.times(2));

  const custoM2Material = paraDecimal(contexto.custoM2Material);

  const orientacoes: Array<{ a: Dec; b: Dec; rotacionado: boolean }> = [
    { a: wLinha, b: hLinha, rotacionado: false },
    { a: hLinha, b: wLinha, rotacionado: true },
  ];

  const candidatos: Candidato[] = [];

  for (const bobina of contexto.bobinas) {
    const larguraNominal = paraDecimal(bobina.larguraNominal);
    const refile = paraDecimal(bobina.refile);
    const wUtil = larguraNominal.minus(refile.times(2));

    for (const { a, b, rotacionado } of orientacoes) {
      const pecasPorFaixa = wUtil.plus(g).div(a.plus(g)).floor().toNumber();
      if (pecasPorFaixa <= 0) continue; // orientação inviável nesta bobina

      const numFaixas = Math.ceil(Q / pecasPorFaixa);
      const lConsumido = paraDecimal(numFaixas).times(b.plus(g));
      const areaFaturavel = larguraNominal.times(lConsumido);
      const custoMaterial = areaFaturavel.times(custoM2Material);

      candidatos.push({
        bobina,
        rotacionado,
        pecasPorFaixa,
        numFaixas,
        areaFaturavel,
        custoMaterial,
      });
    }
  }

  let escolhido: Candidato;
  let custoEmenda = paraDecimal(0);
  let numPaineis: number | undefined;
  const avisos: string[] = [];

  if (candidatos.length === 0) {
    if (!contexto.configuracaoEmenda) {
      throw new ErroPrecificacao(
        "PECA_EXCEDE_BOBINA",
        "Essa peça é maior que todas as bobinas cadastradas para este material. É necessário emendar (solda/costura) — intervenção manual necessária.",
        { larguraM: pedido.larguraM, alturaM: pedido.alturaM }
      );
    }

    // Achado A9: nenhuma orientação coube inteira em nenhuma bobina (loop
    // acima já tentou as 2 orientações × todas as bobinas) — mas o item tem
    // ConfiguracaoEmenda, então em vez de abortar, divide a peça em painéis
    // que cabem na bobina e soma o custo de emenda em vez de lançar erro.
    const custoPorMetroLinear = paraDecimal(contexto.configuracaoEmenda.custoPorMetroLinear);
    const sobreposicaoM = paraDecimal(contexto.configuracaoEmenda.sobreposicaoM);

    type CandidatoEmenda = Candidato & {
      numPaineis: number;
      custoEmendaTotal: Dec;
      custoTotal: Dec;
    };
    const candidatosEmenda: CandidatoEmenda[] = [];

    for (const bobina of contexto.bobinas) {
      const larguraNominal = paraDecimal(bobina.larguraNominal);
      const refile = paraDecimal(bobina.refile);
      const wUtil = larguraNominal.minus(refile.times(2));
      if (wUtil.lte(0)) continue; // bobina sem largura útil positiva não serve nem pra painel

      for (const { a, b, rotacionado } of orientacoes) {
        // nºPainéis = ceil(a / wUtil) — a é a dimensão que corre ao longo da
        // largura da bobina (achado propõe ceil(w/wUtil); usamos a dimensão
        // JÁ ajustada pela margem de segurança, mesma base que o resto da
        // função usa). Se candidatos ficou vazio, a > wUtil garantidamente
        // pras 2 orientações em toda bobina (senão teria virado candidato
        // normal acima) — nºPainéis sempre >= 2 aqui.
        const numPaineisOrientacao = tetoInteiro(a.div(wUtil));
        if (numPaineisOrientacao < 2) continue;

        // Cada painel ocupa sua própria "faixa" ao longo do comprimento da
        // bobina (um painel tem até wUtil de largura, então só 1 cabe por
        // corte) — Q peças × nºPainéis painéis cada, cada painel com
        // comprimento "b" (a dimensão perpendicular à que foi dividida).
        const numFaixas = Q * numPaineisOrientacao;
        const lConsumido = paraDecimal(numFaixas).times(b.plus(g));
        const areaFaturavel = larguraNominal.times(lConsumido);
        const custoMaterial = areaFaturavel.times(custoM2Material);

        // "Comprimento da emenda" = b, a dimensão perpendicular à direção do
        // corte/emenda (normalmente a altura da peça — ver comentário do
        // achado). (nºPainéis - 1) emendas por peça × Q peças no pedido.
        const custoEmendaTotal = custoPorMetroLinear
          .times(b)
          .times(numPaineisOrientacao - 1)
          .times(Q);

        candidatosEmenda.push({
          bobina,
          rotacionado,
          pecasPorFaixa: 1, // 1 painel cabe por corte transversal da bobina
          numFaixas,
          areaFaturavel,
          custoMaterial,
          numPaineis: numPaineisOrientacao,
          custoEmendaTotal,
          custoTotal: custoMaterial.plus(custoEmendaTotal),
        });
      }
    }

    if (candidatosEmenda.length === 0) {
      // Nenhuma bobina cadastrada tem largura útil positiva — emenda não
      // ajuda aqui, mesmo erro de hoje.
      throw new ErroPrecificacao(
        "PECA_EXCEDE_BOBINA",
        "Essa peça é maior que todas as bobinas cadastradas para este material. É necessário emendar (solda/costura) — intervenção manual necessária.",
        { larguraM: pedido.larguraM, alturaM: pedido.alturaM }
      );
    }

    const escolhidoEmenda = candidatosEmenda.reduce((melhor, atual) =>
      atual.custoTotal.lt(melhor.custoTotal) ? atual : melhor
    );

    escolhido = escolhidoEmenda;
    custoEmenda = escolhidoEmenda.custoEmendaTotal;
    numPaineis = escolhidoEmenda.numPaineis;
    avisos.push(
      `Peça de ${w.toFixed(2)}m × ${h.toFixed(2)}m excede a largura útil de todas as bobinas cadastradas — ` +
        `dividida em ${numPaineis} painéis com emenda (sobreposição recomendada de ${sobreposicaoM.toFixed(3)}m por emenda). ` +
        `Custo de emenda somado ao orçamento: R$ ${custoEmenda.toFixed(2)}.`
    );
  } else {
    escolhido = candidatos.reduce((melhor, atual) =>
      atual.custoMaterial.lt(melhor.custoMaterial) ? atual : melhor
    );
  }

  // Achado N18 — área mínima faturável (piso comercial por PEÇA, ex: "cobro
  // no mínimo 1m² por adesivo recortado") agora entra no custo, não só na
  // métrica de auditoria abaixo. areaPecaComMargem é a mesma base
  // (wLinha×hLinha) que sempre alimentou custoImpressao; quando o
  // configurado areaMinimaFaturavel é maior, floora ESSA área antes de
  // multiplicar pelo custo/m² — peça pequena passa a custar como se tivesse
  // a área mínima. maiorDec com areaMinimaFaturavel=0 (padrão, produto sem
  // piso configurado) devolve areaPecaComMargem sem alteração — nenhuma
  // regressão pra quem nunca configurou o campo.
  const areaMinimaFaturavel = paraDecimal(contexto.areaMinimaFaturavel);
  const areaPecaComMargem = wLinha.times(hLinha);
  const areaImpressaoPorPeca = maiorDec(areaPecaComMargem, areaMinimaFaturavel);

  const custoImpressaoM2 = paraDecimal(contexto.custoImpressaoM2);
  const custoImpressao = paraDecimal(Q).times(areaImpressaoPorPeca).times(custoImpressaoM2);
  const custoBase = escolhido.custoMaterial.plus(custoImpressao).plus(custoEmenda);

  // Métrica de EXIBIÇÃO/auditoria — área NOMINAL do pedido (w×h, sem margem
  // de segurança) vs. o mesmo piso, só pra mostrar ao usuário "isso está
  // sendo cobrado como se fosse X m²". Base diferente de areaImpressaoPorPeca
  // acima de propósito (ver comentário no campo areaCobrada do tipo).
  const areaCobrada = maiorDec(
    paraDecimal(Q).times(w).times(h),
    paraDecimal(Q).times(areaMinimaFaturavel)
  );

  const eficiencia = paraDecimal(Q).times(wLinha).times(hLinha).div(escolhido.areaFaturavel);

  return {
    custoMaterial: escolhido.custoMaterial,
    custoImpressao,
    custoBase,
    areaFaturavel: escolhido.areaFaturavel,
    areaCobrada,
    eficiencia,
    bobinaEscolhida: {
      id: escolhido.bobina.id,
      larguraNominal: escolhido.bobina.larguraNominal,
      rotacionado: escolhido.rotacionado,
    },
    pecasPorFaixa: escolhido.pecasPorFaixa,
    numFaixas: escolhido.numFaixas,
    larguraEfetivaM: wLinha,
    alturaEfetivaM: hLinha,
    numPaineis,
    custoEmenda,
    avisos,
  };
}
