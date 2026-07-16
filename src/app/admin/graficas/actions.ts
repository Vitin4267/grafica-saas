"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirSuperAdmin } from "@/lib/auth/superadmin";
import { TRIAL_DIAS } from "@/lib/billing/planos";
import { obterStripe } from "@/lib/billing/stripe-client";

export type AdminGraficaResult = { ok: boolean; mensagem: string };

// Núcleo de "conceder cortesia" — reaproveitado tanto pelo botão por gráfica
// (concederCortesia) quanto pelo atalho "presentear por e-mail"
// (presentearPorEmail), pra nunca divergir a lógica entre os dois caminhos.
// Se a gráfica já pagava de verdade, CANCELA a assinatura real no Stripe
// automaticamente (senão o cartão continuaria sendo cobrado todo mês por trás,
// mesmo com a gráfica "grátis" no app) e zera o vínculo Stripe local. As
// guardas de cortesia no webhook (src/lib/billing/sincronizar.ts) garantem que
// os eventos de cancelamento que chegam depois não revoguem a cortesia.
async function concederCortesiaGrafica(graficaId: string): Promise<string> {
  // Lê o vínculo Stripe ANTES de zerar, pra poder cancelar a cobrança real.
  const atual = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId },
    select: { stripeSubscriptionId: true },
  });

  let avisoStripe = "";
  if (atual?.stripeSubscriptionId) {
    try {
      await obterStripe().subscriptions.cancel(atual.stripeSubscriptionId);
    } catch {
      // Não trava a concessão da cortesia se o cancelamento no Stripe falhar —
      // mas avisa, pra ninguém continuar sendo cobrado sem perceber.
      avisoStripe =
        " Atenção: não consegui cancelar a assinatura no Stripe automaticamente — cancele manualmente no painel do Stripe pra parar a cobrança.";
    }
  }

  await prisma.assinaturaGrafica.upsert({
    where: { graficaId },
    update: {
      status: "ATIVA",
      cortesia: true,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      trialExpiraEm: null,
      canceladaEm: null,
      limiteExcedidoDesde: null,
    },
    create: { graficaId, status: "ATIVA", cortesia: true },
  });

  return avisoStripe;
}

export async function concederCortesia(
  _estadoAnterior: AdminGraficaResult | null,
  formData: FormData
): Promise<AdminGraficaResult> {
  const usuario = await exigirUsuarioAutenticado();
  exigirSuperAdmin(usuario);

  const graficaId = String(formData.get("graficaId"));
  const avisoStripe = await concederCortesiaGrafica(graficaId);

  revalidatePath("/admin/graficas");
  return { ok: true, mensagem: "Acesso cortesia concedido." + avisoStripe };
}

// "Presentear" por e-mail: mesmo efeito de concederCortesia, mas achando a
// gráfica pelo e-mail do DONO em vez de precisar buscar/rolar a lista —
// atalho pedido explicitamente pelo dono da plataforma.
export async function presentearPorEmail(
  _estadoAnterior: AdminGraficaResult | null,
  formData: FormData
): Promise<AdminGraficaResult> {
  const usuario = await exigirUsuarioAutenticado();
  exigirSuperAdmin(usuario);

  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) {
    return { ok: false, mensagem: "Digite um e-mail." };
  }

  const presenteado = await prisma.usuario.findUnique({
    where: { email },
    select: { graficaId: true, grafica: { select: { nome: true } } },
  });
  if (!presenteado) {
    return { ok: false, mensagem: `Nenhuma conta encontrada com o e-mail ${email}.` };
  }

  const avisoStripe = await concederCortesiaGrafica(presenteado.graficaId);

  revalidatePath("/admin/graficas");
  return {
    ok: true,
    mensagem: `Assinatura vitalícia concedida pra "${presenteado.grafica.nome}" (${email}).` + avisoStripe,
  };
}

// Revoga a cortesia devolvendo a gráfica pra um trial novo (mesma janela do
// cadastro normal, TRIAL_DIAS em src/lib/billing/planos.ts) — mais gentil que
// bloquear na hora, dá tempo da gráfica decidir se assina.
export async function revogarCortesia(
  _estadoAnterior: AdminGraficaResult | null,
  formData: FormData
): Promise<AdminGraficaResult> {
  const usuario = await exigirUsuarioAutenticado();
  exigirSuperAdmin(usuario);

  const graficaId = String(formData.get("graficaId"));
  const trialExpiraEm = new Date(Date.now() + 1000 * 60 * 60 * 24 * TRIAL_DIAS);
  await prisma.assinaturaGrafica.update({
    where: { graficaId },
    data: { cortesia: false, status: "TRIALING", trialExpiraEm },
  });

  revalidatePath("/admin/graficas");
  return { ok: true, mensagem: `Cortesia revogada — ${TRIAL_DIAS} dias de trial concedidos.` };
}
