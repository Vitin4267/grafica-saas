import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { mapearStatusStripe } from "@/lib/billing/status";
import { obterStripe } from "@/lib/billing/stripe-client";

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

async function sincronizarSubscription(subscriptionDoEvento: Stripe.Subscription): Promise<void> {
  const graficaId = extrairGraficaId(subscriptionDoEvento);
  if (!graficaId) return; // assinatura sem o metadata que a gente sempre seta — não é nossa, ignora

  // O Stripe não garante ordem de entrega entre eventos (reentrega após
  // timeout pode fazer um evento ANTIGO chegar depois de um mais novo já
  // processado) — confiar no snapshot embutido no evento podia reabrir
  // acesso já revogado (ex: "past_due" mais recente sobrescrito de volta
  // pra "active" por uma reentrega atrasada do evento anterior). Buscando a
  // subscription fresca direto na API do Stripe, sempre pegamos o estado
  // VERDADEIRO atual, não importa qual evento disparou esta chamada — o
  // evento é só o gatilho pra ressincronizar, nunca a fonte do dado.
  const subscription = await obterStripe().subscriptions.retrieve(subscriptionDoEvento.id);

  // Cortesia é soberana: nenhum evento do Stripe pode revogá-la nem rebaixar o
  // status de uma gráfica cortesia. Ao conceder cortesia a assinatura Stripe é
  // cancelada (ver concederCortesia), mas eventos atrasados/já em voo (a
  // própria confirmação do cancelamento, uma renovação que cruzou no caminho)
  // ainda chegam aqui — ignoramos pra não voltar a bloquear/cobrar quem devia
  // estar livre.
  const existente = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId },
    select: { cortesia: true },
  });
  if (existente?.cortesia) return;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const periodoAtualExpiraEm = subscription.items.data[0]?.current_period_end
    ? new Date(subscription.items.data[0].current_period_end * 1000)
    : null;

  // Deriva pelo status JÁ MAPEADO, não pela string bruta do Stripe: além de
  // "canceled", o status "incomplete_expired" também mapeia pra CANCELADA (ver
  // mapearStatusStripe) — sem isso, um checkout que expira no 3D Secure virava
  // CANCELADA com canceladaEm nulo (registro inconsistente).
  const status = mapearStatusStripe(subscription.status);

  await prisma.assinaturaGrafica.upsert({
    where: { graficaId },
    update: {
      status,
      // Qualquer sincronização real do Stripe significa que não é mais
      // cortesia (ver /admin/graficas) — mesmo que a gráfica tivesse sido
      // marcada cortesia antes, um checkout de verdade agora sobrepõe isso.
      cortesia: false,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      periodoAtualExpiraEm,
      canceladaEm: status === "CANCELADA" ? new Date() : null,
      // Sincronização real chegou: a reserva de checkout (ver iniciarCheckout
      // em configuracoes/assinatura/actions.ts) já cumpriu seu papel, não
      // precisa mais segurar novos checkouts por ela.
      checkoutIniciadoEm: null,
    },
    create: {
      graficaId,
      status,
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
      // Não bloqueia cortesia: cancelar a assinatura Stripe é exatamente o que
      // concederCortesia faz, e a confirmação desse cancelamento chega aqui
      // logo depois — não pode marcar CANCELADA quem acabou de virar cortesia.
      const existente = await prisma.assinaturaGrafica.findUnique({
        where: { graficaId },
        select: { cortesia: true },
      });
      if (existente?.cortesia) return;
      // stripeSubscriptionId no where (não só graficaId): o Stripe retenta
      // webhook falho por até 3 dias, então o "deleted" da assinatura ANTIGA
      // pode chegar DEPOIS de a gráfica já ter reassinado. Sem esse filtro,
      // esse evento atrasado cancelava a assinatura NOVA e derrubava o acesso
      // de um cliente pagante, sem nada no app indicando o porquê. Mesma
      // disciplina de "não confiar na ordem de entrega" que sincronizarSubscription
      // já aplicava re-buscando a subscription fresca.
      await prisma.assinaturaGrafica.updateMany({
        where: { graficaId, stripeSubscriptionId: subscription.id },
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
