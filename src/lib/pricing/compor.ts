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
    cliche: Dec;
    faca: Dec;
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
  custoCliche?: Dec; // fixo por cor (clichê de etiqueta) — não escala com a quantidade
  custoFaca?: Dec; // ferramental de corte, R$ livre por item de orçamento
  parametros: ParametrosTenant;
  margemLucroOverride?: number;
  detalhesExtras?: Partial<{ perda: Dec; setup: Dec; chapas: Dec; rodagem: Dec }>;
}): ResultadoComposicao {
  const custoAcabamentos = params.custoAcabamentos ?? paraDecimal(0);
  const custoEmbalagem = params.custoEmbalagem ?? paraDecimal(0);
  const custoFreteEstimado = params.custoFreteEstimado ?? paraDecimal(0);
  const custoCliche = params.custoCliche ?? paraDecimal(0);
  const custoFaca = params.custoFaca ?? paraDecimal(0);

  const custoDireto = params.custoBase
    .plus(custoAcabamentos)
    .plus(custoEmbalagem)
    .plus(custoFreteEstimado)
    .plus(custoCliche)
    .plus(custoFaca);

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

  // Achado N3 da auditoria de abrangência — parametros.pedidoMinimo NÃO é
  // mais aplicado aqui, por ITEM. O rótulo "Pedido mínimo (R$)" em
  // Configurações sempre foi um piso de PEDIDO (todo o orçamento), mas até
  // aqui `maiorDec(precoBruto, pedidoMinimo)` rodava uma vez por LINHA — um
  // orçamento com 3 itens de R$12+R$9+R$4 e mínimo R$30 cobrava R$90 (3× o
  // mínimo) em vez de R$30. O piso agora é aplicado UMA VEZ sobre a SOMA dos
  // itens, depois de somar as linhas — ver aplicarPisoDoPedido logo abaixo,
  // chamada nos pontos que persistem/recalculam Orcamento.total (ver
  // recalcularTotalOrcamento em src/lib/orcamento-precificacao.ts e os
  // pontos de criação de orçamento/opção em src/app/orcamento/actions.ts,
  // src/app/orcamento/[id]/actions.ts e opcoes.actions.ts). Efeito colateral
  // resolvido de brinde: antes o piso era aplicado ANTES deste
  // arredondamento por item, então arredondarParaIncremento podia devolver
  // um valor abaixo do mínimo — aplicarPisoDoPedido aplica o piso e SÓ
  // DEPOIS arredonda, na ordem certa.
  const precoBruto = custoTotal.div(paraDecimal(1).minus(somaEncargosDec));
  const precoFinalAlvo = arredondarParaIncremento(
    precoBruto,
    paraDecimal(params.parametros.incrementoArredondamento)
  );

  // precoUnitario é a fonte única de verdade pro arredondamento: arredonda pra
  // 2 casas aqui (mesma precisão da coluna Decimal(12,2) do Postgres) e deriva
  // precoFinal multiplicando o valor já arredondado pela quantidade. Assim as
  // duas colunas sempre batem entre si quando gravadas no banco — inclusive
  // pra validação de unitário × quantidade da NF-e. Ver calcularPreco em
  // src/lib/orcamento.ts, que segue a mesma ordem.
  const precoUnitario = precoFinalAlvo.div(params.quantidade).toDecimalPlaces(2);
  const precoFinal = precoUnitario.times(params.quantidade);

  if (precoFinal.lt(custoDireto)) {
    throw new ErroPrecificacao(
      "PRECO_ABAIXO_DO_CUSTO",
      "O preço final calculado ficou abaixo do custo direto — configuração de margem/encargos provavelmente incorreta. Orçamento abortado por segurança.",
      { precoFinal: precoFinal.toString(), custoDireto: custoDireto.toString() }
    );
  }

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
      cliche: custoCliche,
      faca: custoFaca,
      overhead,
      margem: margemLucro,
    },
  };
}

// Achado N3 da auditoria de abrangência — piso de PEDIDO, aplicado UMA VEZ
// sobre a SOMA de OrcamentoItem.precoTotal de um orçamento (nunca por item —
// ver comentário em comporPreco acima, que não conhece mais pedidoMinimo).
// Ordem correta: somar as linhas → aplicar o piso → arredondar no incremento
// comercial, nessa ordem (chamar isto ANTES de qualquer arredondamento do
// total evita que o arredondamento devolva um valor abaixo do mínimo).
// Chamada por src/lib/orcamento-precificacao.ts (recalcularTotalOrcamento) e
// pelos pontos que criam Orcamento/OrcamentoOpcao somando itens direto
// (src/app/orcamento/actions.ts, src/app/orcamento/[id]/actions.ts —
// duplicarOrcamento — e src/app/orcamento/[id]/opcoes.actions.ts).
export function aplicarPisoDoPedido(
  somaItens: Dec,
  pedidoMinimo: Dec,
  incrementoArredondamento: Dec
): Dec {
  const comPiso = maiorDec(somaItens, pedidoMinimo);
  return arredondarParaIncremento(comPiso, incrementoArredondamento);
}
