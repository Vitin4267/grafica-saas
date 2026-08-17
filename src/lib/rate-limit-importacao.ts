import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { TipoImportacaoPlanilha } from "@/generated/prisma/enums";

// Cota MENSAL do Importador de planilha com IA (ver
// src/lib/billing/limite-importacao.ts) — mesmo padrão de check+registro
// atômico de rate-limit-tinta.ts (Serializable, na MESMA transação), mas
// contando por MÊS-CALENDÁRIO (não janela rolante) e com o limite vindo por
// PARÂMETRO (resolvido por plano fora daqui) em vez de constante fixa neste
// arquivo. Chamar ANTES do put() no Blob e da chamada ao webhook: se o n8n
// falhar depois, a cota já foi gasta mesmo assim (mesmo raciocínio de
// AnaliseTintaLog — a linha criada aqui É a ImportacaoPlanilha em si, não um
// log à parte).

// Início do mês corrente em UTC — copiado de src/lib/billing/uso.ts
// (inicioDoMesUTC, não exportado de lá): convenção deste projeto é duplicar
// helper puro de data pequeno por arquivo em vez de forçar import
// compartilhado por uma função de 3 linhas.
function inicioDoMesUTC(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
}

export type LimiteImportacao = { bloqueado: boolean; mensagem?: string };

export async function tentarRegistrarImportacao(
  graficaId: string,
  usuarioId: string,
  tipo: TipoImportacaoPlanilha,
  limiteMes: number | null,
  nomeArquivo: string,
  linhasTotal: number
): Promise<LimiteImportacao & { importacaoId?: string }> {
  return prisma.$transaction(
    async (tx) => {
      // null = ilimitado (plano Empresarial ou cortesia, ver
      // resolverLimiteImportacaoMes) — pula a contagem inteira, nunca bloqueia.
      if (limiteMes !== null) {
        const usadoNoMes = await tx.importacaoPlanilha.count({
          where: { graficaId, createdAt: { gte: inicioDoMesUTC() } },
        });
        if (usadoNoMes >= limiteMes) {
          return {
            bloqueado: true,
            mensagem: `Você já usou todas as ${limiteMes} importações do seu plano atual este mês. Faça upgrade pra importar mais.`,
          };
        }
      }

      const nova = await tx.importacaoPlanilha.create({
        data: { graficaId, usuarioId, tipo, nomeArquivo, linhasTotal, status: "MAPEANDO" },
      });
      return { bloqueado: false, importacaoId: nova.id };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
