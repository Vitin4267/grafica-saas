import type Stripe from "stripe";
import type { StatusAssinatura } from "@/generated/prisma/enums";

// Traduz o status bruto do Stripe pro enum local — função pura, sem Prisma
// nem SDK do Stripe instanciado, só o tipo de string que a API devolve.
export function mapearStatusStripe(status: Stripe.Subscription.Status): StatusAssinatura {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ATIVA";
    case "past_due":
    case "unpaid":
      return "INADIMPLENTE";
    case "canceled":
    case "incomplete_expired":
      return "CANCELADA";
    case "incomplete":
    case "paused":
      // Status transitórios/bloqueados por padrão seguro: sem confirmação de
      // pagamento (3D Secure não concluído) ou assinatura pausada não contam
      // como acesso liberado.
      return "INADIMPLENTE";
    default:
      return "INADIMPLENTE";
  }
}

// Decide se o gate de acesso (src/lib/auth/assinatura.ts) libera o app.
// TRIALING só libera enquanto trialExpiraEm não passou — depois disso, sem
// uma assinatura paga de verdade, trava igual a qualquer outro status ruim.
export function assinaturaEstaLiberada(
  assinatura: { status: StatusAssinatura; trialExpiraEm: Date | null } | null,
  agora: Date = new Date()
): boolean {
  if (!assinatura) return false;

  if (assinatura.status === "ATIVA") return true;

  if (assinatura.status === "TRIALING") {
    return assinatura.trialExpiraEm === null || assinatura.trialExpiraEm > agora;
  }

  return false;
}
