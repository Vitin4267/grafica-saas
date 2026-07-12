import "server-only";
import { prisma } from "@/lib/prisma";
import type { UsoAtual } from "@/lib/billing/limite-uso";

// Início do mês corrente em UTC — mesmo cuidado de fuso já usado em
// src/lib/data.ts (data pura sempre em UTC, nunca depende de onde o
// processo roda).
function inicioDoMesUTC(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
}

export async function calcularUsoAtual(graficaId: string): Promise<UsoAtual> {
  const [orcamentosMes, usuarios] = await Promise.all([
    prisma.orcamento.count({
      where: { graficaId, createdAt: { gte: inicioDoMesUTC() } },
    }),
    prisma.usuario.count({ where: { graficaId } }),
  ]);
  return { orcamentosMes, usuarios };
}
