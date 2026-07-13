import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { mapearStatusStripe } from "@/lib/billing/status";

// Resolve o tenant SEMPRE por subscription.metadata.graficaId (setado na
// criação da Checkout Session, ver actions.ts) — nunca por
// stripeSubscriptionId. O Stripe não garante ordem de entrega entre
// checkout.session.completed e customer.subscription.updated; casar pelo
// metadata (que é copiado pro objeto Subscription e persiste em todo evento
// futuro, inclusive edições feitas pelo Customer Portal) elimina essa
// corrida — toda escrita é sempre um upsert where: { graficaId }.
function extrairGraficaId(subscription: Stripe.Subscription): string | null {
  return subscription.metadata.graficaId ?? null;
}

async function sincronizarSubscription(subscription: Stripe.Subscription): Promise<void> {
  const graficaId = extrairGraficaId(subscription);
  if (!graficaId) return; // assinatura sem o metadata que a gente sempre seta — não é nossa, ignora

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const periodoAtualExpiraEm = subscription.items.data[0]?.current_period_end
    ? new Date(subscription.items.data[0].current_period_end * 1000)
    : null;

  await prisma.assinaturaGrafica.upsert({
    where: { graficaId },
    update: {
      status: mapearStatusStripe(subscription.status),
      // Qualquer sincronização real do Stripe significa que não é mais
      // cortesia (ver /admin/graficas) — mesmo que a gráfica tivesse sido
      // marcada cortesia antes, um checkout de verdade agora sobrepõe isso.
      cortesia: false,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      periodoAtualExpiraEm,
      canceladaEm: subscription.status === "canceled" ? new Date() : null,
    },
    create: {
      graficaId,
      status: mapearStatusStripe(subscription.status),
      cortesia: false,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      periodoAtualExpiraEm,
    },
  });
}

// Idempotente por construção (toda escrita é um "set status = X", nunca um
// incremento) — reentregas do Stripe (delivery at-least-once) são
// inofensivas sem precisar de tabela de deduplicação.
export async function processarEventoStripe(evento: Stripe.Event): Promise<void> {
  switch (evento.type) {
    case "checkout.session.completed": {
      const session = evento.data.object;
      if (session.mode !== "subscription" || !session.subscription) return;
      // A Session só tem o id da subscription — o objeto completo (com
      // metadata) chega no evento customer.subscription.updated que o
      // Stripe dispara logo em seguida. Não precisa buscar aqui.
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created":
      await sincronizarSubscription(evento.data.object);
      return;
    case "customer.subscription.deleted": {
      const subscription = evento.data.object;
      const graficaId = extrairGraficaId(subscription);
      if (!graficaId) return;
      await prisma.assinaturaGrafica.updateMany({
        where: { graficaId },
        data: { status: "CANCELADA", canceladaEm: new Date() },
      });
      return;
    }
    case "invoice.payment_failed":
      // No-op de propósito: redundante com customer.subscription.updated,
      // que já chega com status "past_due" na mesma falha de cobrança.
      return;
    default:
      return;
  }
}
