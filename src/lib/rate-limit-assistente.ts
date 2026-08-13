import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

// Protege o assistente de IA contra spam/gasto de token — que hoje corre na
// conta da PLATAFORMA, não da gráfica. Dois limites: por usuário (evita uma
// pessoa sozinha martelando o botão) e por gráfica (evita vários usuários da
// mesma gráfica somados, ou um token de sessão comprometido).
const JANELA_CURTA_MS = 1000 * 60; // 1 minuto
const LIMITE_USUARIO_CURTO = 5;
const LIMITE_GRAFICA_CURTO = 15;

// Segunda camada: um teto diário por gráfica, pra limitar o custo mesmo de um
// abuso "devagar" que fica sempre abaixo do limite de 1 minuto.
const JANELA_DIARIA_MS = 1000 * 60 * 60 * 24;
const LIMITE_GRAFICA_DIARIO = 150;

export type LimiteAssistente = { bloqueado: boolean; mensagem?: string };

// Check + registro na MESMA transação Serializable, igual às funções de
// src/lib/auth/rate-limit.ts. Até 2026-07-26 este arquivo dizia no comentário
// que seguia aquele padrão, mas não seguia: eram 3 count() soltos seguidos de
// um create() separado — o clássico read-then-write. N requisições paralelas
// liam todas a mesma contagem antes de qualquer create commitar e passavam
// juntas, furando os três limites de uma vez (inclusive o teto diário, que é
// justamente o teto de custo da plataforma). Sob Serializable o Postgres
// detecta o padrão e aborta uma das transações — quem chama deve tratar
// ehConflitoDeSerializacao como "bloqueado".
export async function tentarRegistrarPerguntaAssistente(
  usuarioId: string,
  graficaId: string
): Promise<LimiteAssistente> {
  const desdeCurta = new Date(Date.now() - JANELA_CURTA_MS);
  const desdeDiaria = new Date(Date.now() - JANELA_DIARIA_MS);

  return prisma.$transaction(
    async (tx) => {
      const [doUsuario, daGraficaCurta, daGraficaDiaria] = await Promise.all([
        tx.perguntaAssistenteLog.count({
          where: { usuarioId, createdAt: { gte: desdeCurta } },
        }),
        tx.perguntaAssistenteLog.count({
          where: { graficaId, createdAt: { gte: desdeCurta } },
        }),
        tx.perguntaAssistenteLog.count({
          where: { graficaId, createdAt: { gte: desdeDiaria } },
        }),
      ]);

      if (doUsuario >= LIMITE_USUARIO_CURTO) {
        return {
          bloqueado: true,
          mensagem: "Muitas perguntas em pouco tempo. Espere um minuto e tente de novo.",
        };
      }
      if (daGraficaCurta >= LIMITE_GRAFICA_CURTO || daGraficaDiaria >= LIMITE_GRAFICA_DIARIO) {
        return {
          bloqueado: true,
          mensagem:
            "O assistente atingiu o limite de uso da sua gráfica por hoje. Tente novamente mais tarde.",
        };
      }

      // Registrado ANTES de chamar o webhook (quem chama faz isso depois) —
      // assim mesmo uma falha de rede no n8n ainda conta contra o limite.
      await tx.perguntaAssistenteLog.create({ data: { usuarioId, graficaId } });
      return { bloqueado: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
