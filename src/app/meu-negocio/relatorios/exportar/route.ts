import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio } from "@/lib/auth/permissoes";
import { buscarRelatorioNegocio } from "@/lib/relatorios-negocio";
import {
  limitesDiaBrasilia,
  inicioMesAtualBrasilia,
  hojeBrasiliaInputValue,
  dataParaInputValue,
  dataInputParaUTC,
  formatoData,
  formatoInstanteReal,
} from "@/lib/data";
import { D, type Dec } from "@/lib/pricing/decimal";
import { linhaCsv } from "@/lib/csv";

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;

// Mesma disciplina de decimal.js de src/app/financeiro/exportar/route.ts —
// soma acumulada em Number() perde centavos em somas longas.
function formatoValor(valor: number | Dec): string {
  return (valor instanceof D ? valor : new D(valor)).toFixed(2).replace(".", ",");
}

// CSV do relatório de Meu Negócio: linha por pedido (data, cliente,
// faturado, custo, lucro) + resumo do período no topo — mesmo padrão de
// src/app/financeiro/exportar/route.ts (BOM, linhaCsv, attachment). Recebe
// os MESMOS parâmetros de filtro da tela (de/ate/clienteId), resolvidos com
// a mesma regra de default (mês atual em Brasília) pra bater exatamente com
// o que a pessoa está vendo na tela quando clica em exportar.
export async function GET(request: NextRequest) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!podeVerMeuNegocio(usuario)) {
    return new Response("Sem permissão pra ver Meu Negócio.", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const deParam = params.get("de");
  const ateParam = params.get("ate");
  const clienteId = params.get("clienteId") || undefined;

  const deInput = deParam && REGEX_DATA.test(deParam) ? deParam : dataParaInputValue(inicioMesAtualBrasilia());
  const ateInput = ateParam && REGEX_DATA.test(ateParam) ? ateParam : hojeBrasiliaInputValue();
  const inicio = limitesDiaBrasilia(deInput).inicio;
  const fim = limitesDiaBrasilia(ateInput).fim;

  const [relatorio, pedidos, cliente] = await Promise.all([
    buscarRelatorioNegocio({ graficaId: usuario.graficaId, inicio, fim, clienteId }),
    prisma.pedido.findMany({
      where: {
        graficaId: usuario.graficaId,
        // Achado N2 da auditoria de abrangência (2026-09-04) — exclui pedido
        // cancelado, mesmo motivo de buscarRelatorioNegocio (que já não soma
        // este pedido no resumo do topo): sem isso o CSV listava uma linha
        // de "faturado" pra um pedido que não conta mais como faturamento.
        status: { not: "CANCELADO" },
        orcamento: {
          createdAt: { gte: inicio, lt: fim },
          status: "APROVADO",
          ...(clienteId ? { clienteId } : {}),
        },
      },
      select: {
        id: true,
        orcamento: { select: { createdAt: true, total: true, cliente: { select: { nome: true } } } },
        // estornadoEm: null — mesmo motivo de buscarRelatorioNegocio (fase
        // "custo real" §3.3): custo automático estornado no cancelamento do
        // pedido não pode continuar contando contra o lucro exportado.
        custos: { where: { estornadoEm: null }, select: { valor: true } },
      },
      orderBy: { orcamento: { createdAt: "asc" } },
    }),
    clienteId
      ? prisma.cliente.findFirst({
          where: { id: clienteId, graficaId: usuario.graficaId },
          select: { nome: true },
        })
      : Promise.resolve(null),
  ]);

  // Período exibido no cabeçalho: reconstrói a partir das STRINGS de input
  // (deInput/ateInput), não de `inicio`/`fim` — aqueles já têm o offset de
  // Brasília aplicado (limitesDiaBrasilia), então formatá-los com
  // `formatoData` (UTC puro) deslocaria o dia exibido perto da borda da
  // meia-noite. dataInputParaUTC + formatoData é o par correto pra
  // DATA-PURA (ver src/lib/data.ts).
  let csv = "﻿"; // BOM: Excel só reconhece acentuação em UTF-8 com isso.
  csv += linhaCsv([
    `Relatório de Meu Negócio - ${formatoData.format(dataInputParaUTC(deInput))} a ${formatoData.format(dataInputParaUTC(ateInput))}`,
  ]);
  csv += linhaCsv([`Gráfica: ${usuario.grafica.nome}`]);
  csv += linhaCsv([`Cliente: ${clienteId ? (cliente?.nome ?? "Cliente removido") : "Todos"}`]);
  csv += "\r\n";

  csv += linhaCsv(["RESUMO DO PERÍODO"]);
  csv += linhaCsv(["Faturado (R$)", formatoValor(relatorio.metricas.faturado)]);
  csv += linhaCsv(["Pedidos", relatorio.metricas.pedidos]);
  csv += linhaCsv([
    "Ticket médio (R$)",
    relatorio.metricas.ticketMedio !== null ? formatoValor(relatorio.metricas.ticketMedio) : "—",
  ]);
  csv += linhaCsv(["Custos (R$)", formatoValor(relatorio.metricas.custos)]);
  csv += linhaCsv(["Lucro (R$)", formatoValor(relatorio.metricas.lucro)]);
  csv += linhaCsv([
    "Margem (%)",
    relatorio.metricas.margem !== null ? relatorio.metricas.margem.toFixed(2).replace(".", ",") : "—",
  ]);
  csv += "\r\n";

  csv += linhaCsv(["PEDIDOS DO PERÍODO"]);
  csv += linhaCsv(["Data do orçamento", "Cliente", "Faturado (R$)", "Custo (R$)", "Lucro (R$)"]);
  for (const pedido of pedidos) {
    const faturado = new D(pedido.orcamento.total.toString());
    const custo = pedido.custos.reduce((acc, c) => acc.plus(c.valor.toString()), new D(0));
    const lucro = faturado.minus(custo);
    csv += linhaCsv([
      formatoInstanteReal.format(pedido.orcamento.createdAt),
      pedido.orcamento.cliente.nome,
      formatoValor(faturado),
      formatoValor(custo),
      formatoValor(lucro),
    ]);
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorios-negocio-${deInput}_a_${ateInput}.csv"`,
    },
  });
}
