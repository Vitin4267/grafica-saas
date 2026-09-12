import "server-only";

import { prisma } from "@/lib/prisma";
import { D } from "@/lib/pricing/decimal";
import { montarDRE, type ResultadoDRE } from "@/lib/dre";
import { saldoContaReceber } from "@/lib/baixa-financeira";

/**
 * Camada de consulta do DRE (achado A3 da Parte 4 da auditoria de
 * abrangência, 2026-09-05) — busca os agregados no Postgres e entrega pro
 * motor puro (src/lib/dre.ts) montar as linhas. Mesma separação já usada em
 * fluxo-caixa-query.ts/fluxo-caixa.ts (achado A4 da mesma auditoria):
 * NENHUMA regra de negócio mora aqui, só busca e soma.
 *
 * @param graficaId tenant
 * @param inicio início do período (inclusive) — instante real (Brasília),
 *   já resolvido pelo chamador (ver limitesMesBrasilia em src/lib/data.ts).
 * @param fim fim do período (exclusive).
 */
export async function buscarDRE(graficaId: string, inicio: Date, fim: Date): Promise<ResultadoDRE> {
  const semPedidoCancelado = { NOT: { pedido: { status: "CANCELADO" as const } } };

  const [
    orcamentosAprovados,
    parametros,
    custosVariaveisAgregado,
    custoFixoAgregado,
    comissoesAgregado,
    receitaFinanceiraAgregado,
  ] = await Promise.all([
      // Receita bruta + descontos concedidos (achado A3): precisa dos itens
      // (não só o total do orçamento) pra apurar o desconto — ver loop
      // abaixo. Mesmo escopo/exclusão de pedido cancelado de
      // meu-negocio.ts/relatorios-negocio.ts (achado N2).
      prisma.orcamento.findMany({
        where: {
          graficaId,
          status: "APROVADO",
          createdAt: { gte: inicio, lt: fim },
          ...semPedidoCancelado,
        },
        select: {
          total: true,
          itens: { select: { quantidade: true, precoSugeridoUnitario: true, precoTotal: true } },
        },
      }),
      // impostoPercent é ESTIMATIVA (mesmo campo/ressalva de
      // relatorios-negocio.ts e do achado A10 da mesma auditoria) — gráfica
      // que nunca configurou ParametrosGrafica (praticamente nunca, é
      // upsert no primeiro acesso à precificação) cai em 0, não trava o DRE.
      prisma.parametrosGrafica.findUnique({
        where: { graficaId },
        select: { impostoPercent: true },
      }),
      // Custos variáveis (achado A3): CustoPedido cuja CategoriaCusto.natureza
      // = VARIAVEL (achado A2, pré-requisito), não estornado, lançado no
      // período. COMPETÊNCIA — lançado na produção, não necessariamente pago
      // (ex: origem CONSUMO_ESTOQUE nunca corresponde a um pagamento).
      //
      // Achado N22 da Parte 9 (2026-09-12) — mesmo `semPedidoCancelado` da
      // receita acima, agora no custo: antes, cancelar um pedido tirava a
      // RECEITA da DRE mas o CustoPedido de origem automática (comissão/
      // terceirização/compra/despesa — nunca estornado por
      // cancelarPedido, ver src/app/producao/actions.ts) continuava somando
      // aqui pra sempre, derrubando o resultado do mês sem contrapartida
      // nenhuma de receita.
      prisma.custoPedido.aggregate({
        where: {
          graficaId,
          createdAt: { gte: inicio, lt: fim },
          estornadoEm: null,
          categoriaCusto: { natureza: "VARIAVEL" },
          ...semPedidoCancelado,
        },
        _sum: { valor: true },
      }),
      // Custo fixo (achado A3): Despesa PAGA (não pendente) no período cuja
      // CategoriaCusto.natureza = FIXO. CAIXA — só o que de fato saiu.
      prisma.despesa.aggregate({
        where: {
          graficaId,
          status: "PAGA",
          pagoEm: { gte: inicio, lt: fim },
          categoriaCusto: { natureza: "FIXO" },
        },
        _sum: { valor: true },
      }),
      // Comissões pagas no período — linha própria do DRE (proposta:
      // "custo fixo (Despesa FIXO) − comissões"), não misturada em custo
      // fixo porque a Despesa gerada por comissão paga não tem
      // categoriaCustoId (ver Despesa.comissao no schema), então nunca
      // seria contada ali de qualquer forma — mas fica explícito aqui em
      // vez de depender desse acaso.
      prisma.comissao.aggregate({
        where: { graficaId, status: "PAGA", pagoEm: { gte: inicio, lt: fim } },
        _sum: { valorComissao: true },
      }),
      // Receita financeira (achado A5 da Parte 4, 2026-09-09) — juros/multa
      // de fato recebidos em pagamentos criados no período. CAIXA — filtra
      // por orcamento.graficaId (Pagamento não tem graficaId direto no
      // schema), mesmo padrão de meu-negocio.ts.
      prisma.pagamento.aggregate({
        where: { orcamento: { graficaId }, createdAt: { gte: inicio, lt: fim } },
        _sum: { valorJuros: true, valorMulta: true },
      }),
    ]);

  // Achado N23 da Parte 9 (2026-09-12) — perdas com inadimplência (ver
  // comentário em EntradaDRE.perdas, src/lib/dre.ts). Não dá pra ser um
  // aggregate simples: o valor reconhecido é o SALDO em aberto no momento
  // do write-off (mesmo cálculo de calcularExposicaoCreditoCliente), não
  // ContaReceber.valor cheio — uma conta que já tinha recebido uma baixa
  // parcial antes de virar PERDA só reconhece o restante como prejuízo.
  const contasPerda = await prisma.contaReceber.findMany({
    where: { graficaId, status: "PERDA", perdaEm: { gte: inicio, lt: fim } },
    select: { id: true, valor: true, pagamentoId: true },
  });
  const saldosPerda = await Promise.all(contasPerda.map((c) => saldoContaReceber(prisma, c)));
  const perdasDec = saldosPerda.reduce((soma, s) => soma.plus(s), new D(0));

  let receitaBrutaDec = new D(0);
  let descontosDec = new D(0);
  for (const orcamento of orcamentosAprovados) {
    receitaBrutaDec = receitaBrutaDec.plus(String(orcamento.total));
    for (const item of orcamento.itens) {
      if (item.precoSugeridoUnitario === null) continue;
      const sugeridoTotal = new D(String(item.precoSugeridoUnitario)).times(item.quantidade);
      const negociadoTotal = new D(String(item.precoTotal));
      const descontoItem = sugeridoTotal.minus(negociadoTotal);
      // Só conta como desconto quando o negociado ficou ABAIXO do sugerido —
      // um item vendido acima do sugerido (raro, mas o campo não impede) não
      // vira "desconto negativo" que infla a receita líquida por engano.
      if (descontoItem.gt(0)) {
        descontosDec = descontosDec.plus(descontoItem);
      }
    }
  }

  const impostoFracao = parametros?.impostoPercent != null ? new D(String(parametros.impostoPercent)) : new D(0);
  const impostosDec = receitaBrutaDec.times(impostoFracao);

  const custosVariaveisDec = new D(String(custosVariaveisAgregado._sum.valor ?? 0));
  const custoFixoDec = new D(String(custoFixoAgregado._sum.valor ?? 0));
  const comissoesDec = new D(String(comissoesAgregado._sum.valorComissao ?? 0));
  const receitaFinanceiraDec = new D(String(receitaFinanceiraAgregado._sum.valorJuros ?? 0)).plus(
    String(receitaFinanceiraAgregado._sum.valorMulta ?? 0)
  );

  return montarDRE({
    receitaBruta: receitaBrutaDec.toNumber(),
    impostos: impostosDec.toNumber(),
    descontos: descontosDec.toNumber(),
    custosVariaveis: custosVariaveisDec.toNumber(),
    custoFixo: custoFixoDec.toNumber(),
    comissoes: comissoesDec.toNumber(),
    // Sem fonte de dado hoje — ver comentário em EntradaDRE.despesasFinanceiras
    // (src/lib/dre.ts). Despesa financeira estruturada continua fora de
    // escopo (diferente de receita financeira abaixo, que o achado A5
    // constrói nesta rodada).
    despesasFinanceiras: 0,
    receitaFinanceira: receitaFinanceiraDec.toNumber(),
    perdas: perdasDec.toNumber(),
  });
}
