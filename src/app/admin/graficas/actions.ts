"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirSuperAdmin } from "@/lib/auth/superadmin";
import { TRIAL_DIAS } from "@/lib/billing/planos";

export type AdminGraficaResult = { ok: boolean; mensagem: string };

// Concede acesso liberado permanente a uma gráfica sem passar pelo Stripe —
// zera qualquer vínculo Stripe anterior de propósito (ver comentário do
// campo `cortesia` no schema): evita o estado ambíguo de uma gráfica parecer
// "grátis" localmente enquanto ainda tem uma assinatura Stripe real rodando
// por trás. Se a gráfica já pagava de verdade, cancelar a assinatura no
// lado do Stripe é responsabilidade de quem concede, feito manualmente.
export async function concederCortesia(
  _estadoAnterior: AdminGraficaResult | null,
  formData: FormData
): Promise<AdminGraficaResult> {
  const usuario = await exigirUsuarioAutenticado();
  exigirSuperAdmin(usuario);

  const graficaId = String(formData.get("graficaId"));
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

  revalidatePath("/admin/graficas");
  return { ok: true, mensagem: "Acesso cortesia concedido." };
}

// Revoga a cortesia devolvendo a gráfica pra um trial novo de 7 dias (mesma
// janela do cadastro normal, ver TRIAL_DIAS em src/lib/billing/planos.ts) —
// mais gentil que bloquear na hora, dá tempo da gráfica decidir se assina.
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
  return { ok: true, mensagem: "Cortesia revogada — 7 dias de trial concedidos." };
}
