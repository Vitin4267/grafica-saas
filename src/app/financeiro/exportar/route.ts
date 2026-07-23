import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerModulo } from "@/lib/auth/permissoes";
import { formatoData } from "@/lib/data";
import { D, type Dec } from "@/lib/pricing/decimal";
import { linhaCsv } from "@/lib/csv";

// Mesma disciplina de decimal.js usada em orcamento/actions.ts — soma
// acumulada em Number() perde centavos em somas longas por erro de ponto
// flutuante, o que é inaceitável num extrato que o contador vai conferir.
function formatoValor(valor: number | Dec): string {
  return (valor instanceof D ? valor : new D(valor)).toFixed(2).replace(".", ",");
}

// Regime de caixa: receita = pagamento recebido no mês, despesa = despesa
// paga no mês — os dois lados só contam dinheiro que realmente entrou/saiu,
// pra bater com o que o contador espera de um extrato pra DRE simples.
export async function GET(request: NextRequest) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeVerModulo(usuario, "FINANCEIRO"))) {
    return new Response("Sem permissão pra exportar o financeiro.", { status: 403 });
  }

  const mesParam = request.nextUrl.searchParams.get("mes");
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : new Date().toISOString().slice(0, 7);
  const [anoStr, mesStr] = mes.split("-");
  const ano = Number(anoStr);
  const mesNumero = Number(mesStr);
  const inicio = new Date(Date.UTC(ano, mesNumero - 1, 1));
  const fim = new Date(Date.UTC(ano, mesNumero, 1));

  const [pagamentos, despesasPagas, despesasPendentes] = await Promise.all([
    prisma.pagamento.findMany({
      where: {
        orcamento: { graficaId: usuario.graficaId },
        createdAt: { gte: inicio, lt: fim },
      },
      include: { orcamento: { include: { cliente: true, filial: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.despesa.findMany({
      where: { graficaId: usuario.graficaId, status: "PAGA", pagoEm: { gte: inicio, lt: fim } },
      orderBy: { pagoEm: "asc" },
    }),
    prisma.despesa.findMany({
      where: { graficaId: usuario.graficaId, status: "PENDENTE", vencimento: { gte: inicio, lt: fim } },
      orderBy: { vencimento: "asc" },
    }),
  ]);

  const nomeMes = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(inicio);

  let csv = "﻿"; // BOM: Excel só reconhece acentuação em UTF-8 com isso.
  csv += linhaCsv([`Relatório financeiro - ${nomeMes}`]);
  csv += linhaCsv([`Gráfica: ${usuario.grafica.nome}`]);
  csv += "\r\n";

  csv += linhaCsv(["RECEITAS (pagamentos recebidos)"]);
  csv += linhaCsv(["Data", "Cliente", "Filial", "Forma de pagamento", "Valor (R$)"]);
  let totalReceitas = new D(0);
  for (const pagamento of pagamentos) {
    totalReceitas = totalReceitas.plus(pagamento.valor.toString());
    csv += linhaCsv([
      new Date(pagamento.createdAt).toLocaleDateString("pt-BR"),
      pagamento.orcamento.cliente.nome,
      pagamento.orcamento.filial?.nome ?? "",
      pagamento.forma,
      formatoValor(Number(pagamento.valor)),
    ]);
  }
  csv += "\r\n";

  csv += linhaCsv(["DESPESAS PAGAS"]);
  csv += linhaCsv(["Data de pagamento", "Descrição", "Categoria", "Valor (R$)"]);
  let totalDespesasPagas = new D(0);
  for (const despesa of despesasPagas) {
    totalDespesasPagas = totalDespesasPagas.plus(despesa.valor.toString());
    csv += linhaCsv([
      despesa.pagoEm ? new Date(despesa.pagoEm).toLocaleDateString("pt-BR") : "",
      despesa.descricao,
      despesa.categoria ?? "",
      formatoValor(Number(despesa.valor)),
    ]);
  }
  csv += "\r\n";

  csv += linhaCsv(["DESPESAS PENDENTES (vencimento neste mês)"]);
  csv += linhaCsv(["Vencimento", "Descrição", "Categoria", "Valor (R$)"]);
  let totalDespesasPendentes = new D(0);
  for (const despesa of despesasPendentes) {
    totalDespesasPendentes = totalDespesasPendentes.plus(despesa.valor.toString());
    csv += linhaCsv([
      formatoData.format(despesa.vencimento),
      despesa.descricao,
      despesa.categoria ?? "",
      formatoValor(Number(despesa.valor)),
    ]);
  }
  csv += "\r\n";

  csv += linhaCsv(["RESUMO (regime de caixa)"]);
  csv += linhaCsv(["Total de receitas recebidas", formatoValor(totalReceitas)]);
  csv += linhaCsv(["Total de despesas pagas", formatoValor(totalDespesasPagas)]);
  csv += linhaCsv(["Resultado do período", formatoValor(totalReceitas.minus(totalDespesasPagas))]);
  csv += linhaCsv(["Despesas pendentes vencendo no mês (não entram no resultado)", formatoValor(totalDespesasPendentes)]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="financeiro-${mes}.csv"`,
    },
  });
}
