"use server";

import { prisma } from "@/lib/prisma";
import { obterUsuarioAtual } from "@/lib/auth/session";
import { perguntarAssistente, ErroWebhookAssistente } from "@/lib/webhook-assistente";
import { verificarLimiteAssistente, registrarPerguntaAssistente } from "@/lib/rate-limit-assistente";

// Checagem passiva em segundo plano (chamada no mount do widget) — usa
// obterUsuarioAtual() (nunca redireciona) em vez de exigirUsuarioAutenticado(),
// e nunca lança: se algo der errado aqui, o botão flutuante simplesmente não
// aparece, nunca derruba a página que o hospeda.
export async function verificarAssistenteDisponivel(): Promise<boolean> {
  try {
    const usuario = await obterUsuarioAtual();
    if (!usuario) return false;

    const assistente = await prisma.assistenteGrafica.findUnique({
      where: { graficaId: usuario.graficaId },
    });
    return Boolean(assistente?.webhookUrl);
  } catch {
    return false;
  }
}

export type EnviarPerguntaResult =
  | { ok: true; resposta: string }
  | { ok: false; mensagem: string };

const TAMANHO_MAXIMO_PERGUNTA = 500;

export async function enviarPerguntaAssistente(
  pergunta: string,
  pagina: string
): Promise<EnviarPerguntaResult> {
  const usuario = await obterUsuarioAtual();
  if (!usuario) {
    return { ok: false, mensagem: "Sessão expirada — atualize a página." };
  }

  const perguntaLimpa = pergunta.trim().slice(0, TAMANHO_MAXIMO_PERGUNTA);
  if (!perguntaLimpa) {
    return { ok: false, mensagem: "Digite uma pergunta." };
  }

  const assistente = await prisma.assistenteGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });
  if (!assistente?.webhookUrl) {
    return { ok: false, mensagem: "Assistente não configurado." };
  }

  // Rate limit ANTES de gastar a chamada de verdade — protege o token que a
  // própria gráfica paga no n8n contra spam (de um usuário só ou da gráfica
  // toda). Ver src/lib/rate-limit-assistente.ts.
  const limite = await verificarLimiteAssistente(usuario.id, usuario.graficaId);
  if (limite.bloqueado) {
    return { ok: false, mensagem: limite.mensagem ?? "Limite de uso atingido." };
  }
  await registrarPerguntaAssistente(usuario.id, usuario.graficaId);

  try {
    // Payload montado só com estes três campos, sempre — nunca dado de
    // negócio (ver src/lib/webhook-assistente.ts).
    const resposta = await perguntarAssistente(
      { webhookUrl: assistente.webhookUrl },
      { pergunta: perguntaLimpa, pagina, graficaNome: usuario.grafica.nome }
    );
    return { ok: true, resposta: resposta.resposta };
  } catch (erro) {
    if (erro instanceof ErroWebhookAssistente) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }
}
