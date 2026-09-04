import { paraDecimal, type Dec } from "@/lib/pricing/decimal";
import type { DadosItemOrcamento } from "@/lib/orcamento-precificacao";

// Aceita string/number "crus" (útil em teste) ou qualquer Decimal (Prisma.Decimal
// vindo do banco, decimal.js puro) — os dois têm toString(), o bastante pra
// Number()/paraDecimal() converterem sem precisar importar o tipo Decimal do
// Prisma aqui (este arquivo fica testável sem depender do client gerado).
type Decimalish = string | number | { toString(): string };

// Formato mínimo de um OrcamentoItem original + filhos, o bastante pra
// reconstruir os DADOS DE ENTRADA do motor de precificação (nunca o preço em
// si — esse é sempre recalculado do zero, ver duplicarOrcamento em
// src/app/orcamento/[id]/actions.ts). Tipo próprio (não
// `Prisma.OrcamentoItemGetPayload<...>`) só pra esta função continuar
// testável sem depender do include exato usado na action.
export type ItemOrigemParaRecalculo = {
  quantidade: number;
  larguraCm: Decimalish | null;
  alturaCm: Decimalish | null;
  corFrente: number | null;
  corVerso: number | null;
  numeroCoresFlexo: number | null;
  numeroCliques: number | null;
  numeroSetups: number | null;
  numeroPontos: number | null;
  tempoEstimadoMin: Decimalish | null;
  metrosCorte: Decimalish | null;
  horasEstimadas: Decimalish | null;
  custoAquisicaoUnitario: Decimalish | null;
  // Achado N10 — coluna direta em OrcamentoItem (fora do M2 com clichê de
  // etiqueta, que usa precificacaoEtiqueta.custoFaca abaixo). Hoje só
  // preenchida por itens OFFSET — ver comentário em OrcamentoItem.custoFaca
  // no schema.
  custoFaca: Decimalish | null;
  materialFornecidoPeloCliente: boolean;
  acabamentos: { itemGraficaId: string }[];
  precificacaoEtiqueta: {
    papelId: string;
    quantidadeCores: number;
    custoFaca: Decimalish | null;
    custoFrete: Decimalish | null;
  } | null;
};

// Reconstrói os dados de ENTRADA que calcularItemOrcamento precisa pra
// recalcular um item do zero, a partir do item do orçamento ORIGINAL sendo
// duplicado — espelha a mesma composição de objeto que
// adicionarItemOrcamento/criarOrcamento montam a partir do formulário; aqui a
// "entrada do formulário" é o próprio item já salvo no orçamento antigo.
// margemLucroOverride é passado à parte (não faz parte de
// ItemOrigemParaRecalculo) porque é uma propriedade do CLIENTE do
// orçamento, não do item — constante pra todos os itens sendo duplicados,
// resolvida UMA VEZ por quem chama (duplicarOrcamento) a partir do cliente
// do orçamento NOVO (nunca do original: se o cliente ganhou/perdeu a
// margem diferenciada entre a compra original e o "pedir de novo", o
// recálculo reflete o cadastro atual, mesmo princípio de nunca copiar o
// preço do item antigo).
export function montarDadosItemParaRecalculo(
  item: ItemOrigemParaRecalculo,
  margemLucroOverride: number | null
): DadosItemOrcamento {
  return {
    quantidade: item.quantidade,
    larguraCm: item.larguraCm !== null ? Number(item.larguraCm) : null,
    alturaCm: item.alturaCm !== null ? Number(item.alturaCm) : null,
    corFrente: item.corFrente,
    corVerso: item.corVerso,
    numeroCoresFlexo: item.numeroCoresFlexo,
    numeroCliques: item.numeroCliques,
    numeroSetups: item.numeroSetups,
    numeroPontos: item.numeroPontos,
    tempoEstimadoMin: item.tempoEstimadoMin !== null ? Number(item.tempoEstimadoMin) : null,
    metrosCorte: item.metrosCorte !== null ? Number(item.metrosCorte) : null,
    horasEstimadas: item.horasEstimadas !== null ? Number(item.horasEstimadas) : null,
    custoAquisicaoUnitario:
      item.custoAquisicaoUnitario !== null ? Number(item.custoAquisicaoUnitario) : null,
    materialFornecidoPeloCliente: item.materialFornecidoPeloCliente,
    acabamentoIds: item.acabamentos.map((a) => a.itemGraficaId),
    papelId: item.precificacaoEtiqueta?.papelId ?? null,
    quantidadeCores: item.precificacaoEtiqueta?.quantidadeCores ?? null,
    // Achado N10 — precificacaoEtiqueta.custoFaca continua a fonte de
    // verdade pra M2 com clichê (comportamento de sempre); item.custoFaca
    // (coluna direta, hoje só OFFSET) é o fallback pra todo o resto.
    custoFaca:
      item.precificacaoEtiqueta?.custoFaca != null
        ? Number(item.precificacaoEtiqueta.custoFaca)
        : item.custoFaca != null
          ? Number(item.custoFaca)
          : null,
    custoFrete:
      item.precificacaoEtiqueta?.custoFrete != null ? Number(item.precificacaoEtiqueta.custoFrete) : null,
    margemLucroOverride,
  };
}

export type DescontoHerdadoResultado = {
  // Percentual efetivo de desconto do item ORIGINAL, sobre o sugerido de
  // então — é isso que é "herdado", nunca um valor em R$ fixo.
  percentual: Dec;
  precoUnitario: Dec;
  precoTotal: Dec;
};

// Um item ORIGINAL negociado (descontoTipo preenchido) teve o preço reduzido
// em relação ao sugerido de então — mas o valor em R$ não diz respeito ao
// orçamento novo, porque o preço sugerido pode ter mudado (matéria-prima
// reajustada) desde a criação do original. "Mesmo desconto" aqui significa o
// MESMO PERCENTUAL relativo ao sugerido, reaplicado sobre o novo preço
// sugerido já recalculado — nunca o valor absoluto nem o preço final
// digitado originalmente. Uma única regra cobre os 3 tipos de desconto
// (PERCENTUAL, VALOR_ABSOLUTO, PRECO_FINAL): o que sobrevive da negociação
// original é a proporção, não o número.
//
// Devolve null quando não há desconto EFETIVO pra herdar — sugerido original
// inválido, ou preço vendido original maior ou igual ao sugerido (não
// deveria existir na prática, mas não é papel desta função assumir que os
// dados antigos são perfeitos). Não aplica nenhuma trava de negócio (preço
// mínimo, limite de aprovação) — isso depende de contexto que só a action
// tem (ParametrosGrafica, papel do usuário), e fica por conta de quem chama.
export function calcularDescontoHerdado(params: {
  precoSugeridoOriginal: Dec | string;
  precoUnitarioOriginalComDesconto: Dec | string;
  novoPrecoSugeridoUnitario: Dec | string;
  quantidade: number;
}): DescontoHerdadoResultado | null {
  const sugeridoOriginal = paraDecimal(params.precoSugeridoOriginal);
  if (sugeridoOriginal.lte(0)) return null;

  const vendidoOriginal = paraDecimal(params.precoUnitarioOriginalComDesconto);
  const percentual = paraDecimal(1).minus(vendidoOriginal.div(sugeridoOriginal)).times(100);
  if (percentual.lte(0)) return null;

  const novoSugerido = paraDecimal(params.novoPrecoSugeridoUnitario);
  const precoUnitario = novoSugerido.times(paraDecimal(1).minus(percentual.div(100))).toDecimalPlaces(2);
  if (precoUnitario.lte(0)) return null;

  return {
    percentual,
    precoUnitario,
    precoTotal: precoUnitario.times(params.quantidade),
  };
}
