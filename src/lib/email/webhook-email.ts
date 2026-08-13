import "server-only";
import { validarWebhookUrl } from "@/lib/webhook-assistente";
import { construirEnvelope } from "@/lib/webhook-envelope";

// Diferente do hub de automação (src/lib/webhook-automacao.ts, que dispara
// pro webhook que CADA GRÁFICA configura em /configuracoes/automacao),
// este é um webhook único e fixo DA PLATAFORMA (EMAIL_WEBHOOK_URL, env var
// configurada só uma vez, pelo dono do grafica-saas) — e-mail de sistema
// (reset de senha, e futuramente boas-vindas/aviso de cobrança) não é um
// evento "da gráfica X", é da plataforma como um todo, então não pode
// depender de uma gráfica ter configurado automação própria.
//
// n8n do outro lado só precisa de um nó de e-mail (Gmail/Google Workspace)
// mapeando dados.destinatario/assunto/html/texto direto pros campos do nó
// — o corpo do e-mail já vem pronto daqui, não precisa remontar no n8n.
export type EventoEmail = {
  tipo:
    | "reset_senha_solicitado"
    | "verificacao_email_codigo"
    | "estoque_baixo"
    | "trial_expirando"
    | "arte_alteracao_solicitada"
    | "arte_aprovada";
  destinatario: string;
  assunto: string;
  html: string;
  texto: string;
};

const TIMEOUT_MS = 5_000;

// Nunca lança erro pra cima — mesmo princípio de dispararEventoAutomacao:
// e-mail de sistema é "melhor esforço", uma falha aqui nunca pode quebrar
// o fluxo que chamou (ex: pedido de reset de senha continua respondendo
// com a mesma mensagem genérica mesmo se isto falhar).
export async function dispararEventoEmail(evento: EventoEmail): Promise<void> {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
  if (!webhookUrl) return; // não configurado ainda — melhor esforço, não quebra o fluxo

  try {
    const validacao = validarWebhookUrl(webhookUrl);
    if (!validacao.ok) return;

    const { tipo, ...dados } = evento;
    const corpo = JSON.stringify(construirEnvelope(tipo, dados));

    // Segredo opcional (EMAIL_WEBHOOK_SECRET), mesmo padrão de
    // src/lib/webhook-metricas.ts: sem essa env var, o header some do
    // request e o n8n simplesmente não confere nada (melhor esforço, não
    // obriga configuração extra). Com ela, fecha a brecha mais séria dos
    // 4 webhooks de saída do projeto — diferente de automação/métricas
    // (que nunca recebem dado sensível), o payload de e-mail tem
    // destinatario/assunto/html mapeados DIRETO pro nó do Gmail do n8n
    // (comentário acima). Sem o segredo, quem descobrisse a URL do webhook
    // (path previsível do n8n) conseguia mandar e-mail de phishing saindo
    // da conta Gmail legítima da plataforma, passando SPF/DKIM/DMARC —
    // achado da auditoria de 2026-07-26.
    const segredo = process.env.EMAIL_WEBHOOK_SECRET;

    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(segredo ? { "X-Email-Secret": segredo } : {}),
      },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    // melhor esforço — falha aqui nunca deve aparecer pro usuário
  }
}
