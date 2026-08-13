"use server";

import { obterUsuarioAtual } from "@/lib/auth/session";
import { perguntarAssistente, ErroWebhookAssistente } from "@/lib/webhook-assistente";
import { tentarRegistrarPerguntaAssistente } from "@/lib/rate-limit-assistente";
import { assinaturaEstaLiberada } from "@/lib/billing/status";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";

// Webhook ÚNICO da plataforma (mesmo padrão de EMAIL_WEBHOOK_URL) — não pede
// mais que cada gráfica monte o próprio n8n pra ter o assistente (era
// inviável pra maioria dos clientes). Continua nunca recebendo dado de
// negócio no payload (ver src/lib/webhook-assistente.ts), só muda quem
// hospeda o workflow: antes era "bring your own account" por gráfica, agora
// é uma conta só, da plataforma.
export async function verificarAssistenteDisponivel(): Promise<boolean> {
  try {
    const usuario = await obterUsuarioAtual();
    if (!usuario) return false;
    return Boolean(process.env.ASSISTENTE_WEBHOOK_URL);
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
  pagina: string,
  sessaoId: string
): Promise<EnviarPerguntaResult> {
  const usuario = await obterUsuarioAtual();
  if (!usuario) {
    return { ok: false, mensagem: "Sessão expirada — atualize a página." };
  }

  // Gates que faltavam até 2026-07-26: esta era praticamente a única Server
  // Action do app que só exigia sessão. Sem eles, quem criasse conta em
  // /registro e NUNCA confirmasse o e-mail já podia gastar token da
  // plataforma, e gráficas com trial vencido/inadimplentes — bloqueadas em
  // todo o resto do produto — continuavam com o assistente liberado.
  // Checados direto (em vez de exigirEmailVerificado/exigirAssinaturaAtiva)
  // porque aquelas usam redirect(), que não serve numa action que devolve
  // objeto pro chat renderizar a mensagem.
  if (!usuario.emailVerificadoEm) {
    return { ok: false, mensagem: "Confirme seu e-mail pra usar o assistente." };
  }
  if (!assinaturaEstaLiberada(usuario.grafica.assinatura)) {
    return { ok: false, mensagem: "Sua assinatura precisa estar ativa pra usar o assistente." };
  }

  const perguntaLimpa = pergunta.trim().slice(0, TAMANHO_MAXIMO_PERGUNTA);
  if (!perguntaLimpa) {
    return { ok: false, mensagem: "Digite uma pergunta." };
  }

  const webhookUrl = process.env.ASSISTENTE_WEBHOOK_URL;
  if (!webhookUrl) {
    return { ok: false, mensagem: "Assistente não configurado." };
  }

  // Rate limit ANTES de gastar a chamada de verdade — agora protege o custo
  // de token da PLATAFORMA (compartilhado entre todas as gráficas), não só
  // de uma conta própria. Check e registro na mesma transação Serializable
  // (ver src/lib/rate-limit-assistente.ts); conflito de serialização =
  // requisições concorrentes disputando o limite, tratado como bloqueio,
  // mesmo padrão dos call sites de src/lib/auth/rate-limit.ts.
  let limite;
  try {
    limite = await tentarRegistrarPerguntaAssistente(usuario.id, usuario.graficaId);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: "Muitas perguntas ao mesmo tempo. Tente de novo em instantes." };
    }
    throw erro;
  }
  if (limite.bloqueado) {
    return { ok: false, mensagem: limite.mensagem ?? "Limite de uso atingido." };
  }

  try {
    // sessaoId sempre prefixado com o graficaId aqui, nunca aceito cru do
    // cliente — o navegador só manda um UUID aleatório sem significado de
    // tenant nenhum; é este prefixo que garante que duas gráficas nunca
    // colidem no mesmo histórico de conversa da memória do n8n, mesmo se
    // gerassem o mesmo UUID por coincidência.
    const sessaoEscopada = `${usuario.graficaId}:${sessaoId}`;

    // Payload montado só com estes campos, sempre — nunca dado de negócio
    // (ver src/lib/webhook-assistente.ts).
    const resposta = await perguntarAssistente(
      { webhookUrl },
      { pergunta: perguntaLimpa, pagina, graficaNome: usuario.grafica.nome, sessaoId: sessaoEscopada }
    );
    return { ok: true, resposta: resposta.resposta };
  } catch (erro) {
    if (erro instanceof ErroWebhookAssistente) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }
}
