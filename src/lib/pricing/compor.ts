import { type Dec, paraDecimal, arredondarParaIncremento, maiorDec } from "./decimal";
import { ErroPrecificacao } from "./erros";
import { validarSomaEncargos } from "./validar";
import type { ParametrosTenant } from "./tipos";
import type { ItemAcabamentoCalculado } from "./acabamento";

export type ResultadoComposicao = {
  precoFinal: Dec;
  precoUnitario: Dec;
  custoDireto: Dec; // custoBase + acabamentos + embalagem + frete (spec §4)
  custoTotal: Dec; // custoDireto × (1 + overhead)
  somaEncargos: Dec;
  detalhes: {
    material: Dec;
    perda?: Dec;
    setup?: Dec;
    chapas?: Dec;
    rodagem?: Dec;
    acabamentos: ItemAcabamentoCalculado[];
    embalagem: Dec;
    frete: Dec;
    overhead: Dec;
    margem: Dec;
  };
};

export function comporPreco(params: {
  quantidade: number;
  custoBase: Dec; // saída de calcularM2/calcularOffset (material/impressão OU papel/chapas/rodagem/setup)
  custoAcabamentos?: Dec;
  acabamentosDetalhe?: ItemAcabamentoCalculado[];
  custoEmbalagem?: Dec;
  custoFreteEstimado?: Dec;
  parametros: ParametrosTenant;
  margemLucroOverride?: number;
  detalhesExtras?: Partial<{ perda: Dec; setup: Dec; chapas: Dec; rodagem: Dec }>;
}): ResultadoComposicao {
  const custoAcabamentos = params.custoAcabamentos ?? paraDecimal(0);
  const custoEmbalagem = params.custoEmbalagem ?? paraDecimal(0);
  const custoFreteEstimado = params.custoFreteEstimado ?? paraDecimal(0);

  const custoDireto = params.custoBase
    .plus(custoAcabamentos)
    .plus(custoEmbalagem)
    .plus(custoFreteEstimado);

  const overheadPercent = paraDecimal(params.parametros.overheadPercent);
  const overhead = custoDireto.times(overheadPercent);
  const custoTotal = custoDireto.times(paraDecimal(1).plus(overheadPercent));

  const margemLucro = paraDecimal(
    params.margemLucroOverride ?? params.parametros.margemPadrao
  );
  const somaEncargosDec = margemLucro
    .plus(params.parametros.impostoPercent)
    .plus(params.parametros.comissaoPercent)
    .plus(params.parametros.taxaFinanceiraPercent);

  validarSomaEncargos(somaEncargosDec.toNumber());

  const precoBruto = custoTotal.div(paraDecimal(1).minus(somaEncargosDec));
  const precoComPiso = maiorDec(precoBruto, paraDecimal(params.parametros.pedidoMinimo));
  const precoFinal = arredondarParaIncremento(
    precoComPiso,
    paraDecimal(params.parametros.incrementoArredondamento)
  );

  if (precoFinal.lt(custoDireto)) {
    throw new ErroPrecificacao(
      "PRECO_ABAIXO_DO_CUSTO",
      "O preço final calculado ficou abaixo do custo direto — configuração de margem/encargos provavelmente incorreta. Orçamento abortado por segurança.",
      { precoFinal: precoFinal.toString(), custoDireto: custoDireto.toString() }
    );
  }

  const precoUnitario = precoFinal.div(params.quantidade);

  return {
    precoFinal,
    precoUnitario,
    custoDireto,
    custoTotal,
    somaEncargos: somaEncargosDec,
    detalhes: {
      material: params.custoBase,
      perda: params.detalhesExtras?.perda,
      setup: params.detalhesExtras?.setup,
      chapas: params.detalhesExtras?.chapas,
      rodagem: params.detalhesExtras?.rodagem,
      acabamentos: params.acabamentosDetalhe ?? [],
      embalagem: custoEmbalagem,
      frete: custoFreteEstimado,
      overhead,
      margem: margemLucro,
    },
  };
}
