import "server-only";

import { prisma } from "@/lib/prisma";

// Tempo generoso pra completar o redirect até o Checkout hospedado do Stripe
// e voltar (webhook confirmar) antes de considerar a reserva abandonada.
export const RESERVA_CHECKOUT_MS = 1000 * 60 * 2;

export type ReservaCheckout =
  | { reservado: true; agora: Date }
  | { reservado: false; motivo: "assinatura_ativa" | "checkout_em_andamento" };

// Reserva ATÔMICA contra checkout duplicado (duas abas, duplo clique): o
// updateMany só afeta a linha se, no momento exato da escrita, ela ainda não
// tiver assinatura paga viva NEM reserva de checkout recente — as duas
// condições E o carimbo de reserva acontecem no mesmo statement, então duas
// requisições concorrentes nunca passam as duas (a segunda vê o
// checkoutIniciadoEm que a primeira acabou de gravar e falha a condição).
// Sem isso (achado da auditoria de 2026-07-23), duas requisições simultâneas
// partindo de TRIALING liam "sem assinatura ainda" ao mesmo tempo e abriam
// duas Checkout Sessions reais no Stripe — cobrando duas vezes.
export async function reservarCheckout(graficaId: string): Promise<ReservaCheckout> {
  const agora = new Date();
  const limiteReserva = new Date(agora.getTime() - RESERVA_CHECKOUT_MS);

  const reserva = await prisma.assinaturaGrafica.updateMany({
    where: {
      graficaId,
      AND: [
        { OR: [{ stripeSubscriptionId: null }, { status: { notIn: ["ATIVA", "INADIMPLENTE"] } }] },
        { OR: [{ checkoutIniciadoEm: null }, { checkoutIniciadoEm: { lt: limiteReserva } }] },
      ],
    },
    data: { checkoutIniciadoEm: agora },
  });

  if (reserva.count === 0) {
    const atual = await prisma.assinaturaGrafica.findUnique({ where: { graficaId } });
    if (atual?.stripeSubscriptionId && (atual.status === "ATIVA" || atual.status === "INADIMPLENTE")) {
      return { reservado: false, motivo: "assinatura_ativa" };
    }
    return { reservado: false, motivo: "checkout_em_andamento" };
  }

  return { reservado: true, agora };
}

// Libera a reserva (só a NOSSA, pelo carimbo exato) quando a chamada ao
// Stripe falha depois — pra não travar o usuário pelos 2 minutos inteiros
// só porque o Stripe deu erro.
export async function liberarReservaCheckout(graficaId: string, agora: Date) {
  await prisma.assinaturaGrafica.updateMany({
    where: { graficaId, checkoutIniciadoEm: agora },
    data: { checkoutIniciadoEm: null },
  });
}
