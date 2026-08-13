import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

// Protege o cálculo de tinta com IA contra gasto excessivo — a chamada de
// visão roda na conta da PLATAFORMA (mesmo modelo do assistente de chat, ver
// rate-limit-assistente.ts), então cada análise é dinheiro real do dono do
// produto, não da gráfica. Três janelas, não duas: a mensal é a que de fato
// limita a fatura de pior caso por tenant — sem ela, um teto só diário (20)
// ainda permitiria 600/mês, bem acima de qualquer uso legítimo.
const JANELA_CURTA_MS = 1000 * 60; // 1 minuto
const LIMITE_USUARIO_CURTO = 3; // não é chat — escolher arquivo, clicar, esperar ~30s

const JANELA_DIARIA_MS = 1000 * 60 * 60 * 24;
const LIMITE_GRAFICA_DIARIO = 20;

const JANELA_MENSAL_MS = 1000 * 60 * 60 * 24 * 30; // rolante, não mês-calendário
const LIMITE_GRAFICA_MENSAL = 200;

export type LimiteTinta = { bloqueado: boolean; mensagem?: string };

// Check + registro na MESMA transação Serializable — mesmo padrão de
// tentarRegistrarPerguntaAssistente (ver o comentário lá sobre o bug de
// read-then-write que essa disciplina existe pra evitar). Chamar ANTES do
// put() no Blob e da chamada ao webhook: aqui é ainda mais importante que no
// assistente, porque se o n8n estourar o timeout os tokens da IA já foram
// gastos mesmo assim — falha de rede tem que contar contra o limite.
export async function tentarRegistrarAnaliseTinta(
  usuarioId: string,
  graficaId: string
): Promise<LimiteTinta> {
  const desdeCurta = new Date(Date.now() - JANELA_CURTA_MS);
  const desdeDiaria = new Date(Date.now() - JANELA_DIARIA_MS);
  const desdeMensal = new Date(Date.now() - JANELA_MENSAL_MS);

  return prisma.$transaction(
    async (tx) => {
      const [doUsuario, daGraficaDiaria, daGraficaMensal] = await Promise.all([
        tx.analiseTintaLog.count({ where: { usuarioId, createdAt: { gte: desdeCurta } } }),
        tx.analiseTintaLog.count({ where: { graficaId, createdAt: { gte: desdeDiaria } } }),
        tx.analiseTintaLog.count({ where: { graficaId, createdAt: { gte: desdeMensal } } }),
      ]);

      if (doUsuario >= LIMITE_USUARIO_CURTO) {
        return {
          bloqueado: true,
          mensagem: "Muitas análises em pouco tempo. Espere um minuto e tente de novo.",
        };
      }
      if (daGraficaDiaria >= LIMITE_GRAFICA_DIARIO) {
        return {
          bloqueado: true,
          mensagem: "Limite diário de análises de tinta atingido. Tente novamente amanhã.",
        };
      }
      if (daGraficaMensal >= LIMITE_GRAFICA_MENSAL) {
        return {
          bloqueado: true,
          mensagem: "Limite mensal de análises de tinta atingido pra sua gráfica.",
        };
      }

      await tx.analiseTintaLog.create({ data: { usuarioId, graficaId } });
      return { bloqueado: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
