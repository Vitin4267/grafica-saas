import "server-only";
import { obterStripe } from "@/lib/billing/stripe-client";
import { formatoMoeda } from "@/lib/moeda";
import type { Plano } from "@/lib/billing/planos";

export type PlanoComPreco = Plano & { precoFormatado: string | null };

const ROTULO_INTERVALO: Record<string, string> = {
  month: "/mês",
  year: "/ano",
  week: "/semana",
  day: "/dia",
};

// Busca o preço de verdade no Stripe (nunca duplicado aqui, mesmo espírito
// já documentado em planos.ts) — se a chamada falhar por qualquer motivo
// (Price apagado, Stripe fora do ar), o card do plano simplesmente não
// mostra preço, nunca quebra a página.
export async function anexarPrecos(planos: Plano[]): Promise<PlanoComPreco[]> {
  const stripe = obterStripe();
  return Promise.all(
    planos.map(async (plano) => {
      try {
        const price = await stripe.prices.retrieve(plano.stripePriceId);
        if (price.unit_amount === null) {
          return { ...plano, precoFormatado: null };
        }
        const intervalo = price.recurring ? (ROTULO_INTERVALO[price.recurring.interval] ?? "") : "";
        return { ...plano, precoFormatado: `${formatoMoeda.format(price.unit_amount / 100)}${intervalo}` };
      } catch {
        return { ...plano, precoFormatado: null };
      }
    })
  );
}
