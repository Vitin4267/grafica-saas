"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirPapel } from "@/lib/auth/permissoes";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { obterStripe } from "@/lib/billing/stripe-client";
import { obterPriceId, type Intervalo, type PlanoId } from "@/lib/billing/planos";
import { DIAS_TOLERANCIA_LIMITE } from "@/lib/billing/limite-uso";
import { reservarCheckout, liberarReservaCheckout } from "@/lib/billing/checkout-reserva";
import type { StatusAssinatura } from "@/generated/prisma/enums";

export type AssinaturaActionResult = { ok: boolean; mensagem: string };

export type ResumoAssinatura = {
  status: StatusAssinatura;
  diasRestantesTrial: number | null;
  limiteExcedidoDesde: string | null;
  diasAteBloqueio: number | null;
  souSuperAdmin: boolean;
};

// Usado pelo banner global (UserNav.tsx) pra deixar claro, em QUALQUER
// página, que a gráfica está em trial (e quantos dias faltam) ou passou do
// limite de uso do plano (e quantos dias faltam pro bloqueio) — não só na
// tela /configuracoes/assinatura. Nunca chama exigirAssinaturaAtiva (senão
// o banner nunca apareceria pra quem já está bloqueado) nem exigirPapel
// (qualquer usuário autenticado, não só DONO, deve ver o aviso).
//
// Também devolve `souSuperAdmin` pro UserNav decidir se mostra o link
// "Admin" (/admin/graficas) — reaproveita esta mesma chamada em vez de mais
// uma Server Action só pra isso; a checagem de acesso de verdade continua
// em exigirSuperAdmin() dentro de admin/graficas, este flag aqui é só pra UI.
export async function obterResumoAssinatura(): Promise<ResumoAssinatura | null> {
  const usuario = await exigirUsuarioAutenticado();
  const assinatura = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });
  if (!assinatura) return null;

  const diasRestantesTrial = assinatura.trialExpiraEm
    ? Math.ceil((assinatura.trialExpiraEm.getTime() - Date.now()) / 86_400_000)
    : null;

  const diasAteBloqueio = assinatura.limiteExcedidoDesde
    ? DIAS_TOLERANCIA_LIMITE -
      Math.floor((Date.now() - assinatura.limiteExcedidoDesde.getTime()) / 86_400_000)
    : null;

  return {
    status: assinatura.status,
    diasRestantesTrial,
    limiteExcedidoDesde: assinatura.limiteExcedidoDesde?.toISOString() ?? null,
    diasAteBloqueio,
    souSuperAdmin: usuario.superAdmin,
  };
}

// Cria uma Stripe Checkout Session (modo assinatura) e redireciona o DONO
// pro Checkout hospedado do próprio Stripe — nunca coletamos dado de cartão
// aqui dentro. subscription_data.metadata.graficaId é o que o webhook usa
// pra achar o tenant depois (ver src/app/api/webhooks/stripe/route.ts):
// sobrevive a toda mudança futura da assinatura (upgrade, reativação pelo
// Customer Portal), diferente de tentar casar por stripeSubscriptionId.
const PLANOS_VALIDOS: PlanoId[] = ["basico", "pro", "empresarial"];
const INTERVALOS_VALIDOS: Intervalo[] = ["mensal", "semestral", "anual"];

export async function iniciarCheckout(
  _estadoAnterior: AssinaturaActionResult | null,
  formData: FormData
): Promise<AssinaturaActionResult> {
  const usuario = await exigirUsuarioAutenticado();
  exigirPapel(usuario, ["DONO"]);

  const planoId = formData.get("planoId");
  if (typeof planoId !== "string" || !PLANOS_VALIDOS.includes(planoId as PlanoId)) {
    return { ok: false, mensagem: "Plano inválido." };
  }

  // Intervalo é opcional no FormData por retrocompatibilidade (nunca deveria
  // faltar vindo da UI atual) — sem ele, cai no mensal, que é o único
  // intervalo garantido pra qualquer plano listado.
  const intervaloBruto = formData.get("intervalo");
  const intervalo: Intervalo =
    typeof intervaloBruto === "string" && INTERVALOS_VALIDOS.includes(intervaloBruto as Intervalo)
      ? (intervaloBruto as Intervalo)
      : "mensal";

  // Resolve o Price ID certo pro (plano, intervalo) pedido. Isto não deveria
  // acontecer na prática (a UI só oferece intervalo já configurado pro
  // plano), mas defende mesmo assim contra FormData montado à mão / estado
  // stale do client.
  const stripePriceId = obterPriceId(planoId as PlanoId, intervalo);
  if (!stripePriceId) {
    return { ok: false, mensagem: "Esse intervalo de cobrança não está disponível pra este plano." };
  }

  const origem = await resolverOrigemPublica();
  const stripe = obterStripe();

  const reserva = await reservarCheckout(usuario.graficaId);
  if (!reserva.reservado) {
    return {
      ok: false,
      mensagem:
        reserva.motivo === "assinatura_ativa"
          ? 'Você já tem uma assinatura ativa. Use "Gerenciar assinatura" pra trocar de plano.'
          : "Um checkout já foi iniciado há pouco. Aguarde um instante e tente de novo.",
    };
  }

  const assinatura = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: assinatura?.stripeCustomerId ?? undefined,
      customer_email: assinatura?.stripeCustomerId ? undefined : usuario.email,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      success_url: `${origem}/configuracoes/assinatura?checkout=sucesso`,
      cancel_url: `${origem}/configuracoes/assinatura?checkout=cancelado`,
      client_reference_id: usuario.graficaId,
      subscription_data: { metadata: { graficaId: usuario.graficaId } },
    });
  } catch {
    await liberarReservaCheckout(usuario.graficaId, reserva.agora);
    return { ok: false, mensagem: "Não consegui iniciar o checkout no Stripe. Tente novamente." };
  }

  if (!session.url) {
    await liberarReservaCheckout(usuario.graficaId, reserva.agora);
    return { ok: false, mensagem: "O Stripe não devolveu uma URL de checkout." };
  }

  redirect(session.url);
}

// Link pro Customer Portal hospedado do próprio Stripe — cobre de graça
// histórico de fatura, troca de cartão e cancelamento, sem precisar
// construir nenhuma dessas telas aqui.
export async function abrirPortalCliente(
  _estadoAnterior: AssinaturaActionResult | null,
  _formData: FormData
): Promise<AssinaturaActionResult> {
  const usuario = await exigirUsuarioAutenticado();
  exigirPapel(usuario, ["DONO"]);

  const assinatura = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });
  if (!assinatura?.stripeCustomerId) {
    return { ok: false, mensagem: "Nenhuma assinatura ativa encontrada pra gerenciar." };
  }

  const origem = await resolverOrigemPublica();
  const stripe = obterStripe();

  let session: Awaited<ReturnType<typeof stripe.billingPortal.sessions.create>>;
  try {
    session = await stripe.billingPortal.sessions.create({
      customer: assinatura.stripeCustomerId,
      return_url: `${origem}/configuracoes/assinatura`,
    });
  } catch {
    return { ok: false, mensagem: "Não consegui abrir o portal do Stripe. Tente novamente." };
  }

  redirect(session.url);
}
