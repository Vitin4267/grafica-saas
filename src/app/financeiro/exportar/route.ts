import { NextRequest } from "next/server";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerModulo } from "@/lib/auth/permissoes";
import {
  limitesDiaBrasilia,
  inicioMesAtualBrasilia,
  hojeBrasiliaInputValue,
  dataParaInputValue,
  dataInputParaUTC,
  somarDiasInputValue,
  formatoData,
  formatoInstanteReal,
} from "@/lib/data";
import { D, type Dec } from "@/lib/pricing/decimal";
import { linhaCsv } from "@/lib/csv";
import { buscarDadosExportacaoFinanceira } from "@/lib/exportacao-financeira-query";
import { ROTULO_FAIXA_AGING, ROTULO_NATUREZA } from "@/lib/exportacao-financeira";

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;

// Mesma disciplina de decimal.js usada em orcamento/actions.ts — soma
// acumulada em Number() perde centavos em somas longas por erro de ponto
// flutuante, o que é inaceitável num extrato que o contador vai conferir.
function formatoValor(valor: number | Dec): string {
  return (valor instanceof D ? valor : new D(valor)).toFixed(2).replace(".", ",");
}

// "OUTRO — cheque pré-datado" em vez de só "OUTRO", quando há detalhe salvo
// (Pagamento.formaDetalhe) — mesma disciplina de PagamentosCard.tsx.
function rotuloForma(forma: string, detalhe: string | null) {
  return forma === "OUTRO" && detalhe ? `${forma} — ${detalhe}` : forma;
}

// Achado A16 da Parte 4 da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md, 2026-09-07): a exportação era "foto mensal fixa" (só ?mes=) e
// só 3 blocos (pagamentos, despesas pagas/pendentes). Agora aceita
// intervalo LIVRE (?de=&ate=, mesmo padrão de src/app/meu-negocio/
// relatorios/exportar/route.ts) e ganhou blocos novos: contas a receber com
// aging, comissões, custos por pedido, agrupamento por categoria com
// subtotal por natureza, DRE do período e possíveis duplicidades de
// recebimento — toda a busca/agregação mora em
// src/lib/exportacao-financeira-query.ts, este arquivo só formata CSV.
//
// Regime de caixa nos blocos de receita/despesa (como sempre foi): receita =
// pagamento recebido no período, despesa = despesa paga no período. O bloco
// DRE novo é o único que mistura regime de propósito, e cada linha dele
// já vem rotulada (ver src/lib/dre.ts).
export async function GET(request: NextRequest) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeVerModulo(usuario, "FINANCEIRO"))) {
    return new Response("Sem permissão pra exportar o financeiro.", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const deParam = params.get("de");
  const ateParam = params.get("ate");

  // Compatibilidade com o link antigo (?mes=AAAA-MM, ainda pode estar em
  // favorito/automação de alguém): se vier só `mes` e nenhum `de`/`ate`,
  // convertido pro mês inteiro — sem isso um link salvo quebraria em vez de
  // continuar funcionando.
  const mesParam = params.get("mes");
  let deInput: string;
  let ateInput: string;
  if (!deParam && !ateParam && mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
    const [anoStr, mesStr] = mesParam.split("-");
    const ano = Number(anoStr);
    const mesNumero = Number(mesStr);
    deInput = `${anoStr}-${mesStr}-01`;
    // Último dia do mês: dia 0 do mês seguinte.
    const ultimoDia = new Date(Date.UTC(ano, mesNumero, 0)).getUTCDate();
    ateInput = `${anoStr}-${mesStr}-${String(ultimoDia).padStart(2, "0")}`;
  } else {
    // Sem filtro, o padrão é o mês corrente no calendário de BRASÍLIA até
    // hoje — não `toISOString()` (que é UTC e, nas ~3h finais de cada dia,
    // já teria virado o mês/dia — ver src/lib/data.ts).
    deInput = deParam && REGEX_DATA.test(deParam) ? deParam : dataParaInputValue(inicioMesAtualBrasilia());
    ateInput = ateParam && REGEX_DATA.test(ateParam) ? ateParam : hojeBrasiliaInputValue();
  }

  // Despesa.vencimento/ContaReceber.vencimento são DATA-PURA (meia-noite
  // UTC) — fronteira em UTC puro, sem offset de Brasília (ver
  // dataInputParaUTC/src/lib/data.ts). Fim é EXCLUSIVO: dia seguinte ao
  // `ate` escolhido.
  const inicioLiteral = dataInputParaUTC(deInput);
  const fimLiteral = dataInputParaUTC(somarDiasInputValue(ateInput, 1));
  // Pagamento.createdAt, Despesa.pagoEm, Comissao.createdAt/pagoEm e
  // CustoPedido.createdAt são INSTANTE REAL — fronteira com offset de
  // Brasília (limitesDiaBrasilia), senão um pagamento das 22h do último dia
  // (ainda dentro do dia em Brasília) cairia fora do CSV que vai pro
  // contador.
  const { inicio: inicioReal } = limitesDiaBrasilia(deInput);
  const { fim: fimReal } = limitesDiaBrasilia(ateInput);

  const dados = await buscarDadosExportacaoFinanceira(usuario.graficaId, {
    inicioReal,
    fimReal,
    inicioLiteral,
    fimLiteral,
  });

  let csv = "﻿"; // BOM: Excel só reconhece acentuação em UTF-8 com isso.
  csv += linhaCsv([
    `Relatório financeiro - ${formatoData.format(dataInputParaUTC(deInput))} a ${formatoData.format(dataInputParaUTC(ateInput))}`,
  ]);
  csv += linhaCsv([`Gráfica: ${usuario.grafica.nome}`]);
  csv += "\r\n";

  csv += linhaCsv(["RECEITAS (pagamentos recebidos)"]);
  csv += linhaCsv(["Data", "Cliente", "Filial", "Forma de pagamento", "Valor (R$)"]);
  for (const pagamento of dados.pagamentos) {
    csv += linhaCsv([
      formatoInstanteReal.format(pagamento.data),
      pagamento.clienteNome,
      pagamento.filialNome ?? "",
      rotuloForma(pagamento.forma, pagamento.formaDetalhe),
      formatoValor(pagamento.valor),
    ]);
  }
  csv += "\r\n";

  csv += linhaCsv(["DESPESAS PAGAS"]);
  csv += linhaCsv(["Data de pagamento", "Descrição", "Categoria", "Filial", "Valor (R$)"]);
  for (const despesa of dados.despesasPagas) {
    csv += linhaCsv([
      despesa.data ? formatoInstanteReal.format(despesa.data) : "",
      despesa.descricao,
      despesa.categoria ?? "",
      despesa.filialNome ?? "",
      formatoValor(despesa.valor),
    ]);
  }
  csv += "\r\n";

  csv += linhaCsv(["DESPESAS PENDENTES (vencimento no período)"]);
  csv += linhaCsv(["Vencimento", "Descrição", "Categoria", "Filial", "Valor (R$)"]);
  for (const despesa of dados.despesasPendentes) {
    csv += linhaCsv([
      despesa.data ? formatoData.format(despesa.data) : "",
      despesa.descricao,
      despesa.categoria ?? "",
      despesa.filialNome ?? "",
      formatoValor(despesa.valor),
    ]);
  }
  csv += "\r\n";

  csv += linhaCsv([
    "CONTAS A RECEBER EM ABERTO (vencimento até o fim do período, incluindo vencidas de antes) — aging calculado em relação a hoje",
  ]);
  csv += linhaCsv(["Vencimento", "Descrição", "Cliente", "Filial", "Status", "Saldo em aberto (R$)", "Dias de atraso", "Faixa"]);
  for (const conta of dados.contasAReceber) {
    csv += linhaCsv([
      formatoData.format(conta.vencimento),
      conta.descricao,
      conta.clienteNome,
      conta.filialNome ?? "",
      conta.status,
      formatoValor(conta.saldo),
      conta.diasAtraso,
      ROTULO_FAIXA_AGING[conta.faixaAging],
    ]);
  }
  csv += "\r\n";

  csv += linhaCsv(["COMISSÕES"]);
  csv += linhaCsv(["Data", "Vendedor", "Cliente", "Filial", "Status", "Pago em", "Valor (R$)"]);
  for (const comissao of dados.comissoes) {
    csv += linhaCsv([
      formatoInstanteReal.format(comissao.createdAt),
      comissao.vendedorNome,
      comissao.clienteNome,
      comissao.filialNome ?? "",
      comissao.status,
      comissao.pagoEm ? formatoInstanteReal.format(comissao.pagoEm) : "",
      formatoValor(comissao.valorComissao),
    ]);
  }
  csv += "\r\n";

  csv += linhaCsv(["CUSTOS POR PEDIDO (lançados no período)"]);
  csv += linhaCsv(["Pedido", "Cliente", "Filial", "Qtd. lançamentos", "Total (R$)"]);
  for (const custo of dados.custosPorPedido) {
    csv += linhaCsv([
      `#${custo.pedidoId.slice(-6)}`,
      custo.clienteNome,
      custo.filialNome ?? "",
      custo.quantidadeLancamentos,
      formatoValor(custo.total),
    ]);
  }
  csv += "\r\n";

  csv += linhaCsv(["CUSTOS POR CATEGORIA (Despesa paga + Custo de pedido no período)"]);
  csv += linhaCsv(["Categoria", "Natureza", "Total (R$)"]);
  for (const categoria of dados.agrupamentoCategoria.categorias) {
    csv += linhaCsv([categoria.categoriaNome, ROTULO_NATUREZA[categoria.natureza], formatoValor(categoria.total)]);
  }
  for (const natureza of dados.agrupamentoCategoria.naturezas) {
    csv += linhaCsv([`Subtotal ${ROTULO_NATUREZA[natureza.natureza]}`, "", formatoValor(natureza.total)]);
  }
  csv += linhaCsv(["Total geral", "", formatoValor(dados.agrupamentoCategoria.totalGeral)]);
  csv += "\r\n";

  csv += linhaCsv(["DRE SIMPLIFICADO DO PERÍODO"]);
  csv += linhaCsv(["Linha", "Regime", "Valor (R$)"]);
  for (const linha of dados.dre.linhas) {
    csv += linhaCsv([linha.rotulo, linha.regime, formatoValor(linha.valor)]);
  }
  csv += "\r\n";

  csv += linhaCsv([
    "POSSÍVEIS DUPLICIDADES DE RECEBIMENTO — candidatos pra revisão manual, não é certeza",
  ]);
  csv += linhaCsv([
    "Um Pagamento lançado manualmente na tela do orçamento e uma Conta a Receber marcada como recebida separadamente podem contar o mesmo dinheiro duas vezes (sem deduplicação automática entre os dois caminhos — ver comentário em Pagamento.contaReceber no schema). Heurística: soma dos pagamentos do orçamento no período ultrapassa o total do orçamento.",
  ]);
  csv += linhaCsv(["Cliente", "Orçamento", "Qtd. pagamentos", "Total do orçamento (R$)", "Total pago no período (R$)", "Diferença (R$)"]);
  for (const candidato of dados.candidatosDuplicidade) {
    csv += linhaCsv([
      candidato.clienteNome,
      `#${candidato.orcamentoId.slice(-6)}`,
      candidato.quantidadePagamentos,
      formatoValor(candidato.totalOrcamento),
      formatoValor(candidato.totalPago),
      formatoValor(candidato.diferenca),
    ]);
  }
  if (dados.candidatosDuplicidade.length === 0) {
    csv += linhaCsv(["Nenhum candidato encontrado no período."]);
  }
  csv += "\r\n";

  csv += linhaCsv(["RESUMO (regime de caixa)"]);
  csv += linhaCsv(["Total de receitas recebidas", formatoValor(dados.totais.receitas)]);
  csv += linhaCsv(["Total de despesas pagas", formatoValor(dados.totais.despesasPagas)]);
  csv += linhaCsv(["Resultado do período", formatoValor(dados.totais.receitas.minus(dados.totais.despesasPagas))]);
  csv += linhaCsv(["Despesas pendentes vencendo no período (não entram no resultado)", formatoValor(dados.totais.despesasPendentes)]);
  csv += linhaCsv(["Contas a receber em aberto com vencimento até o fim do período (não entram no resultado)", formatoValor(dados.totais.contasAReceberAbertas)]);
  csv += linhaCsv(["Comissões pagas no período", formatoValor(dados.totais.comissoesPagas)]);
  csv += linhaCsv(["Custos por pedido lançados no período", formatoValor(dados.totais.custosPedido)]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="financeiro-${deInput}_a_${ateInput}.csv"`,
    },
  });
}
