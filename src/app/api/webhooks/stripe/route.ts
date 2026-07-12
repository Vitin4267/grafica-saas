import type Stripe from "stripe";
import { obterStripe } from "@/lib/billing/stripe-client";
import { processarEventoStripe } from "@/lib/billing/sincronizar";

// Chamado direto pelo Stripe, sem sessão de usuário — por isso é um Route
// Handler (não Server Action). Corpo lido CRU via request.text() (Route
// Handlers do App Router não fazem parsing automático) e a assinatura é
// validada com o segredo do webhook antes de confiar em qualquer coisa no
// corpo — sem isso, qualquer um poderia forjar "assinatura ativada".
export async function POST(request: Request): Promise<Response> {
  const segredo = process.env.STRIPE_WEBHOOK_SIGNING_SECRET;
  if (!segredo) {
    return new Response("Webhook do Stripe não configurado.", { status: 500 });
  }

  const corpo = await request.text();
  const assinatura = request.headers.get("stripe-signature");
  if (!assinatura) {
    return new Response("Cabeçalho stripe-signature ausente.", { status: 400 });
  }

  let evento: Stripe.Event;
  try {
    evento = obterStripe().webhooks.constructEvent(corpo, assinatura, segredo);
  } catch (erro) {
    return new Response(`Webhook inválido: ${(erro as Error).message}`, { status: 400 });
  }

  await processarEventoStripe(evento);
  return new Response(null, { status: 200 });
}
