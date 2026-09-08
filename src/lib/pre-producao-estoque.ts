import type { Prisma } from "@/generated/prisma/client";
import type { ModeloCalculo, UnidadeMedida } from "@/generated/prisma/enums";
import { D } from "@/lib/pricing/decimal";
import { calcularQuantidadeConsumidaFichaProduto } from "@/lib/baixa-estoque-substrato";
import { snapshotCustoFicha, snapshotLoteFicha } from "@/app/producao/status-transicao";

// Estoque de produto pré-produzido (pedido direto do dono, 2026-09-08 — ver
// deep-zooming-parasol.md): a gráfica pode fabricar um PRODUTO
// especulativamente (ex: 5.000 cartões de visita padrão) ANTES de qualquer
// pedido existir, consumindo matéria-prima pela ficha técnica na hora e
// guardando o resultado como "produto pronto em estoque"
// (ItemGrafica.estoqueAtual do PRODUTO — mesmo campo que já existia, hoje
// inerte pra esse papel). Depois, quando um pedido de fato chegar pra este
// produto, pode ser atendido direto desse estoque (ver o branch condicional
// em avancarStatusPedido, src/app/producao/status-transicao.ts) em vez de
// rodar produção do zero.
//
// Reaproveita literalmente calcularQuantidadeConsumidaFichaProduto,
// snapshotCustoFicha e snapshotLoteFicha (o MESMO motor que avancarStatusPedido
// usa pra baixa de produção de verdade) — nunca reescreve essa lógica.
// `breakdown: null` no item sintético abaixo faz o motor de substrato
// (M2/OFFSET/FLEXOGRAFIA) cair sempre no consumo LINEAR
// (quantidadePorUnidade × quantidade): não há orçamento/pedido nenhum aqui,
// então não existe nesting/imposição específico de um pedido pra aplicar —
// é sempre a ficha técnica "crua" do produto, multiplicada pela quantidade
// que a gráfica decidiu pré-produzir.

// Sinaliza que a matéria-prima de UMA linha da ficha técnica não tem saldo
// suficiente — aborta a transação inteira (nada fica parcialmente gravado),
// mesmo espírito de ErroEstoqueInsuficienteRefugo/ErroEstoqueInsuficienteAtendimento
// em status-transicao.ts.
export class ErroEstoqueInsuficientePreProducao extends Error {
  constructor(public readonly materiaPrimaNome: string) {
    super(`Estoque insuficiente de "${materiaPrimaNome}" pra pré-produzir esta quantidade.`);
  }
}

export type ItemGraficaParaPreProducao = {
  id: string;
  modeloCalculo: ModeloCalculo;
  papelId: string | null;
  nome: string;
  fichaTecnica: Array<{
    materiaPrimaId: string;
    varianteId: string | null;
    ehSubstratoPrincipal: boolean;
    quantidadePorUnidade: Prisma.Decimal | number | string;
    materiaPrima: {
      controlaLote: boolean;
      precoCompra: Prisma.Decimal | null;
      updatedAt: Date;
      estoqueAtual: Prisma.Decimal | number | null;
      itemCatalogo: { nome: string; unidade: UnidadeMedida | null };
    };
    variante: {
      id: string;
      precoCompra: Prisma.Decimal;
      estoqueAtual: Prisma.Decimal | number | null;
    } | null;
  }>;
};

export type ResultadoPreProducao = {
  custoUnitario: string | null;
  custoTotal: string | null;
};

// Chamada DENTRO de uma transação (Serializable, mesmo padrão de
// avancarStatusPedido) — o chamador (lancarProducaoEspeculativa em
// src/app/catalogo/[itemGraficaId]/actions.ts) já buscou e validou
// `itemGrafica` (tenant + tipo=PRODUTO) FORA da transação, mesmo padrão de
// buscarOrcamentoParaBaixa/avancarStatusPedido — mantém a transação curta.
export async function producirEstoqueEspeculativo(
  tx: Prisma.TransactionClient,
  params: {
    itemGrafica: ItemGraficaParaPreProducao;
    quantidade: number;
    criadoPorId: string | null;
  }
): Promise<ResultadoPreProducao> {
  // Soma só as linhas com custo APURADO (precoCompra cadastrado na matéria-
  // prima/variante) — uma ficha técnica com algum material sem preço
  // cadastrado ainda produz um custo PARCIAL conhecido (não inventa R$0,00
  // pra ele, mas também não desiste do que É conhecido). Só quando NENHUMA
  // linha tem preço cadastrado (ou a ficha técnica está vazia) o resultado
  // final fica null — "custo não apurado", nunca R$0,00 mentindo que foi
  // apurado como zero (mesmo princípio de snapshotCustoFicha).
  let custoTotalAcumulado = new D(0);
  let houveCustoConhecido = false;

  for (const ficha of params.itemGrafica.fichaTecnica) {
    const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
    if (estoqueAtual === null) continue; // sem controle de estoque, mesma regra de sempre

    const quantidadeConsumida = calcularQuantidadeConsumidaFichaProduto(
      {
        modeloCalculo: params.itemGrafica.modeloCalculo,
        // Sem breakdown — ver comentário no topo do arquivo: pré-produção
        // nunca tem orçamento/pedido, então cai sempre no consumo linear.
        breakdown: null,
        quantidade: params.quantidade,
        itemGrafica: { papelId: params.itemGrafica.papelId },
        precificacaoEtiqueta: null,
      },
      ficha
    );
    if (quantidadeConsumida <= 0) continue;

    // CAS por linha — mesmo padrão de updateMany condicional (estoqueAtual:
    // { gte: ... }) usado em toda baixa de estoque deste sistema. Aborta a
    // transação inteira se faltar matéria-prima (nada fica parcialmente
    // gravado): o chamador decide se tenta de novo com quantidade menor.
    if (ficha.varianteId) {
      const cas = await tx.varianteMateriaPrima.updateMany({
        where: { id: ficha.varianteId, estoqueAtual: { gte: quantidadeConsumida } },
        data: { estoqueAtual: { decrement: quantidadeConsumida } },
      });
      if (cas.count === 0) {
        throw new ErroEstoqueInsuficientePreProducao(ficha.materiaPrima.itemCatalogo.nome);
      }
    } else {
      const cas = await tx.itemGrafica.updateMany({
        where: { id: ficha.materiaPrimaId, estoqueAtual: { gte: quantidadeConsumida } },
        data: { estoqueAtual: { decrement: quantidadeConsumida } },
      });
      if (cas.count === 0) {
        throw new ErroEstoqueInsuficientePreProducao(ficha.materiaPrima.itemCatalogo.nome);
      }
    }

    const movimentacaoConsumo = await tx.movimentacaoEstoque.create({
      data: {
        itemGraficaId: ficha.materiaPrimaId,
        varianteId: ficha.varianteId,
        // Sem pedidoId — pré-produção especulativa não está atrelada a
        // nenhum pedido (ver decisão de design no plano).
        pedidoId: null,
        tipo: "SAIDA_PRODUCAO",
        quantidade: quantidadeConsumida,
        motivo: `Pré-produção especulativa de ${params.quantidade} unidade(s) de "${params.itemGrafica.nome}"`,
        criadoPorId: params.criadoPorId,
        ...snapshotCustoFicha(ficha, quantidadeConsumida),
        ...(await snapshotLoteFicha(tx, ficha)),
      },
    });

    if (movimentacaoConsumo.custoTotal !== null) {
      houveCustoConhecido = true;
      custoTotalAcumulado = custoTotalAcumulado.plus(movimentacaoConsumo.custoTotal.toString());
    }
  }

  const custoTotalFinal = houveCustoConhecido ? custoTotalAcumulado.toFixed(2) : null;
  const custoUnitarioFinal = houveCustoConhecido
    ? custoTotalAcumulado.div(params.quantidade).toFixed(4)
    : null;

  // Incremento puro (não CAS) — diferente das baixas acima, aqui não há
  // "saldo mínimo" a proteger: somar ao próprio estoque do produto que está
  // sendo fabricado nunca pode falhar por falta de saldo. Prisma traduz
  // `{ increment }` num único `UPDATE ... SET col = col + $1` atômico no
  // Postgres — seguro sob concorrência sem precisar de CAS (diferente de um
  // `update` que gravasse um valor ABSOLUTO calculado fora da transação).
  //
  // Ressalva: `col + $1` no Postgres dá NULL quando `col` já é NULL (SQL
  // trata qualquer aritmética com NULL como NULL) — e é exatamente esse o
  // estado inicial de todo PRODUTO hoje (estoqueAtual nunca foi escrito
  // nesse papel antes desta feature). Por isso tenta primeiro um `updateMany`
  // condicional (`estoqueAtual: null` no where) que INICIALIZA com o valor
  // absoluto só se ainda for null; se não bater (já tinha um número, seja de
  // uma pré-produção anterior ou de uma concorrente que inicializou primeiro
  // — o UPDATE da outra transação bloqueia esta até committar, então esta
  // relê o valor já não-null), cai no increment normal. Correto sob
  // concorrência nos dois casos.
  const inicializacao = await tx.itemGrafica.updateMany({
    where: { id: params.itemGrafica.id, estoqueAtual: null },
    data: { estoqueAtual: params.quantidade },
  });
  if (inicializacao.count === 0) {
    await tx.itemGrafica.update({
      where: { id: params.itemGrafica.id },
      data: { estoqueAtual: { increment: params.quantidade } },
    });
  }

  await tx.movimentacaoEstoque.create({
    data: {
      itemGraficaId: params.itemGrafica.id,
      pedidoId: null,
      tipo: "ENTRADA_PRODUCAO",
      quantidade: params.quantidade,
      motivo: `Produção especulativa de ${params.quantidade} unidade(s)`,
      criadoPorId: params.criadoPorId,
      custoUnitario: custoUnitarioFinal,
      custoTotal: custoTotalFinal,
    },
  });

  return { custoUnitario: custoUnitarioFinal, custoTotal: custoTotalFinal };
}
