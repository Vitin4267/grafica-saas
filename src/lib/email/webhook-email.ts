import "server-only";
import * as Sentry from "@sentry/nextjs";
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
    | "arte_aprovada"
    | "estagio_responsavel"
    | "orcamento_aprovado"
    | "orcamento_recusado"
    | "pedido_prazo_proximo"
    | "pedido_prazo_atrasado";
  destinatario: string;
  assunto: string;
  html: string;
  texto: string;
};

const TIMEOUT_MS = 5_000;

// Contexto reportado quando o disparo falha — nunca inclui
// destinatario/assunto/html/texto (dado pessoal do e-mail) nem o segredo do
// webhook, só o suficiente pra diagnosticar QUAL evento falhou e POR QUE.
// Achado de 2026-08-13: antes disso, uma EMAIL_WEBHOOK_URL ausente na Vercel
// (ou um n8n fora do ar) fazia o código de verificação nunca sair, e como a
// falha era engolida em silêncio, a conta nova ficava travada pra sempre na
// tela de verificação de e-mail sem nenhuma pista do que houve.
type ContextoFalhaEnvio = { urlConfigurada: boolean; motivo?: string; status?: number };

function reportarFalhaEnvio(tipo: EventoEmail["tipo"], contexto: ContextoFalhaEnvio, erro?: unknown) {
  const extra = { tipoEvento: tipo, ...contexto };
  if (erro !== undefined) {
    Sentry.captureException(erro, { extra });
  } else {
    Sentry.captureMessage("Falha ao disparar e-mail de sistema (webhook)", {
      level: "error",
      extra,
    });
  }
  // console.error sempre roda, mesmo sem SENTRY_DSN configurado (Sentry.* é
  // no-op nesse caso) — garante que a falha ao menos aparece nos logs da
  // Vercel.
  console.error("[email/webhook] falha ao disparar e-mail de sistema", extra, erro ?? "");
}

// Nunca lança erro pra cima — mesmo princípio de dispararEventoAutomacao:
// e-mail de sistema é "melhor esforço", uma falha aqui nunca pode quebrar
// o fluxo que chamou (ex: pedido de reset de senha continua respondendo
// com a mesma mensagem genérica mesmo se isto falhar). Mas a falha agora é
// OBSERVÁVEL: reportada ao Sentry/console (ver reportarFalhaEnvio acima) e
// refletida no retorno (true = enviado com sucesso, false = falhou por
// qualquer motivo) — quem chama decide se quer ou não agir sobre isso.
export async function dispararEventoEmail(evento: EventoEmail): Promise<boolean> {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
  if (!webhookUrl) {
    reportarFalhaEnvio(evento.tipo, { urlConfigurada: false });
    return false; // não configurado ainda — melhor esforço, não quebra o fluxo
  }

  try {
    const validacao = validarWebhookUrl(webhookUrl);
    if (!validacao.ok) {
      reportarFalhaEnvio(evento.tipo, { urlConfigurada: true, motivo: "url_invalida" });
      return false;
    }

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

    const resposta = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(segredo ? { "X-Email-Secret": segredo } : {}),
      },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });

    if (!resposta.ok) {
      reportarFalhaEnvio(evento.tipo, { urlConfigurada: true, status: resposta.status });
      return false;
    }

    return true;
  } catch (erro) {
    // melhor esforço — falha aqui nunca deve aparecer pro usuário como erro
    // não tratado, mas precisa ficar registrada (ver reportarFalhaEnvio).
    reportarFalhaEnvio(evento.tipo, { urlConfigurada: true }, erro);
    return false;
  }
}
