import "server-only";
import { prisma } from "@/lib/prisma";

// Mesmo padrão de src/lib/auth/rate-limit.ts (conta linhas de log numa janela
// de tempo) — protege o assistente de IA contra spam/gasto de token do n8n
// da própria gráfica. Dois limites: por usuário (evita uma pessoa sozinha
// martelando o botão) e por gráfica (evita vários usuários da mesma gráfica
// somados, ou um único token de sessão comprometido).
const JANELA_CURTA_MS = 1000 * 60; // 1 minuto
const LIMITE_USUARIO_CURTO = 5;
const LIMITE_GRAFICA_CURTO = 15;

// Segunda camada: um teto diário por gráfica, pra limitar o custo mesmo de um
// abuso "devagar" que fica sempre abaixo do limite de 10 minutos.
const JANELA_DIARIA_MS = 1000 * 60 * 60 * 24;
const LIMITE_GRAFICA_DIARIO = 150;

export type LimiteAssistente = { bloqueado: boolean; mensagem?: string };

export async function verificarLimiteAssistente(
  usuarioId: string,
  graficaId: string
): Promise<LimiteAssistente> {
  const desdeCurta = new Date(Date.now() - JANELA_CURTA_MS);
  const desdeDiaria = new Date(Date.now() - JANELA_DIARIA_MS);

  const [doUsuario, daGraficaCurta, daGraficaDiaria] = await Promise.all([
    prisma.perguntaAssistenteLog.count({
      where: { usuarioId, createdAt: { gte: desdeCurta } },
    }),
    prisma.perguntaAssistenteLog.count({
      where: { graficaId, createdAt: { gte: desdeCurta } },
    }),
    prisma.perguntaAssistenteLog.count({
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
      mensagem: "O assistente atingiu o limite de uso da sua gráfica por hoje. Tente novamente mais tarde.",
    };
  }

  return { bloqueado: false };
}

export async function registrarPerguntaAssistente(usuarioId: string, graficaId: string) {
  await prisma.perguntaAssistenteLog.create({ data: { usuarioId, graficaId } });
}
