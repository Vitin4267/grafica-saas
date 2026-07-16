import "server-only";
import { validarWebhookUrl } from "@/lib/webhook-assistente";
import { construirEnvelope } from "@/lib/webhook-envelope";

// Webhook ÚNICO da plataforma (METRICAS_WEBHOOK_URL) pra métricas internas
// de negócio irem pro n8n — não confundir com o hub de automação por
// gráfica (src/lib/webhook-automacao.ts) nem com o webhook de e-mail
// (src/lib/email/webhook-email.ts). Este é sobre O PRODUTO como um todo
// (novo registro, tamanho do banco, uso agregado), não sobre uma gráfica
// específica nem sobre disparar e-mail. Mesmo espírito de "melhor esforço,
// nunca lança" do webhook de e-mail: sem a env var, ou se ela apontar pra
// um destino inválido/interno, a função simplesmente não faz nada.
export type EventoMetrica = {
  tipo: "novo_registro" | "metricas_diarias";
  dados: Record<string, unknown>;
};

const TIMEOUT_MS = 5_000;

export async function dispararMetrica(evento: EventoMetrica): Promise<void> {
  const webhookUrl = process.env.METRICAS_WEBHOOK_URL;
  if (!webhookUrl) return; // não configurado — melhor esforço, não quebra o fluxo

  try {
    const validacao = validarWebhookUrl(webhookUrl);
    if (!validacao.ok) return;

    const corpo = JSON.stringify(construirEnvelope(evento.tipo, evento.dados));

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error", // não segue redirect — mesma cautela de perguntarAssistente
    });
  } catch {
    // melhor esforço — falha aqui nunca deve derrubar quem chamou
  }
}
