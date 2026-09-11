import "server-only";

import { prisma } from "@/lib/prisma";
import { calcularProjecaoFluxoCaixa, type ProjecaoFluxoCaixa } from "@/lib/fluxo-caixa";

/**
 * Busca a projeção de fluxo de caixa para uma gráfica.
 *
 * Limitação conhecida: saldo inicial está fixo em 0. Um conceito de
 * "saldo inicial configurável" é previsto pra uma rodada futura.
 *
 * @param graficaId ID da gráfica
 * @returns Projeção de fluxo de caixa com buckets e alertas
 */
export async function buscarProjecaoFluxoCaixa(graficaId: string): Promise<ProjecaoFluxoCaixa> {
  // Busca contas a receber PENDENTES, PARCIAIS ou EM_COBRANCA — os 3 ainda
  // representam dinheiro esperado (achado A5 da Parte 4, 2026-09-09; ver
  // comentário em StatusContaReceber no schema). PERDA fica de fora, mesmo
  // critério de CANCELADO: dinheiro não é mais esperado.
  const contasReceber = await prisma.contaReceber.findMany({
    where: {
      graficaId,
      status: { in: ["PENDENTE", "PARCIAL", "EM_COBRANCA"] },
    },
    select: {
      vencimento: true,
      valor: true,
    },
  });

  // Busca despesas PENDENTES ou PARCIAIS
  const despesas = await prisma.despesa.findMany({
    where: {
      graficaId,
      status: { in: ["PENDENTE", "PARCIAL"] },
    },
    select: {
      vencimento: true,
      valor: true,
    },
  });

  // Saldo inicial em 0 (limitação conhecida documentada acima)
  const saldoInicial = 0;

  // Calcula a projeção usando a função pura
  return calcularProjecaoFluxoCaixa(
    saldoInicial,
    // Converte Decimal em number para a função pura
    contasReceber.map((cr: { vencimento: Date; valor: unknown }) => ({
      vencimento: cr.vencimento,
      valor: Number(cr.valor),
    })),
    despesas.map((d: { vencimento: Date; valor: unknown }) => ({
      vencimento: d.vencimento,
      valor: Number(d.valor),
    }))
  );
}
