import { type Dec, paraDecimal, maiorDec } from "./decimal";
import { ErroPrecificacao } from "./erros";
import { validarPedidoM2 } from "./validar";
import type { Bobina, ContextoM2, PedidoM2 } from "./tipos";

export type ResultadoM2 = {
  custoMaterial: Dec;
  custoImpressao: Dec;
  custoBase: Dec; // custoMaterial + custoImpressao — NÃO é o custoDireto final (ver compor.ts)
  areaFaturavel: Dec;
  areaCobrada: Dec; // métrica de auditoria/exibição; não realimenta o nesting
  eficiencia: Dec;
  bobinaEscolhida: { id: string; larguraNominal: number; rotacionado: boolean };
  pecasPorFaixa: number;
  numFaixas: number;
  larguraEfetivaM: Dec; // w' — reaproveitado pelo cálculo de acabamento (base M2)
  alturaEfetivaM: Dec; // h'
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

  if (candidatos.length === 0) {
    throw new ErroPrecificacao(
      "PECA_EXCEDE_BOBINA",
      "Essa peça é maior que todas as bobinas cadastradas para este material. É necessário emendar (solda/costura) — intervenção manual necessária.",
      { larguraM: pedido.larguraM, alturaM: pedido.alturaM }
    );
  }

  const escolhido = candidatos.reduce((melhor, atual) =>
    atual.custoMaterial.lt(melhor.custoMaterial) ? atual : melhor
  );

  const custoImpressaoM2 = paraDecimal(contexto.custoImpressaoM2);
  const custoImpressao = paraDecimal(Q).times(wLinha).times(hLinha).times(custoImpressaoM2);
  const custoBase = escolhido.custoMaterial.plus(custoImpressao);

  const areaMinimaFaturavel = paraDecimal(contexto.areaMinimaFaturavel);
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
  };
}
