import "server-only";
import type Stripe from "stripe";
import { obterStripe } from "@/lib/billing/stripe-client";
import { formatoMoeda } from "@/lib/moeda";
import { INTERVALOS, type Intervalo, type Plano } from "@/lib/billing/planos";

export type PrecoIntervalo = {
  precoFormatado: string;
  // % de economia vs. o preço mensal do MESMO plano, calculado a partir dos
  // valores reais vindos do Stripe (nunca hardcoded 15%/20% — a decisão de
  // negócio já foi tomada, mas o texto tem que continuar batendo mesmo se o
  // Price configurado no Stripe divergir um pouco do combinado). null pro
  // próprio intervalo mensal (não há "economia" vs. si mesmo) e sempre que
  // não dá pra comparar (preço mensal não resolvido, ou unit_amount zerado).
  economiaPercentual: number | null;
};

// Preços por intervalo configurado com sucesso — um intervalo ausente aqui
// (chave não existe) significa "não configurado pra este plano" (env var
// não setada) OU "falhou ao buscar no Stripe" (Price apagado, Stripe fora do
// ar): os dois casos tratados da mesma forma por quem consome, o intervalo
// simplesmente não aparece como opção.
export type PlanoComPreco = Plano & { precos: Partial<Record<Intervalo, PrecoIntervalo>> };

// Rótulo do intervalo pro texto do card ("/mês", "/semestre", "/ano"...).
// Pegadinha real do Stripe: não existe `recurring.interval === "semester"` —
// "a cada 6 meses" é representado como interval:"month" + interval_count:6.
// Sem considerar interval_count, um Price semestral seria rotulado "/mês"
// (errado). Cobre genericamente qualquer combinação (inclusive interval_count
// > 1 fora dos 3 intervalos oferecidos hoje, se algum dia aparecer).
function rotularIntervalo(recurring: Stripe.Price.Recurring): string {
  const { interval, interval_count: intervalCount } = recurring;
  if (interval === "month" && intervalCount === 6) return "/semestre";

  const singular: Record<Stripe.Price.Recurring.Interval, string> = {
    day: "dia",
    week: "semana",
    month: "mês",
    year: "ano",
  };
  const plural: Record<Stripe.Price.Recurring.Interval, string> = {
    day: "dias",
    week: "semanas",
    month: "meses",
    year: "anos",
  };
  return intervalCount > 1 ? `/${intervalCount} ${plural[interval]}` : `/${singular[interval]}`;
}

// Normaliza o valor recorrente de um Price pro equivalente MENSAL, em
// centavos — só assim dá pra comparar "economia" entre intervalos
// diferentes (ex: anual / 12 vs. mensal). week/day não fazem sentido nesse
// produto (assinatura B2B mensal+) — não tenta normalizar, economia fica
// null pra esses casos (defensivo, não deveria ocorrer na prática).
function valorMensalEquivalente(price: Stripe.Price): number | null {
  if (!price.recurring || price.unit_amount === null) return null;
  const { interval, interval_count: intervalCount } = price.recurring;
  if (interval === "month") return price.unit_amount / intervalCount;
  if (interval === "year") return price.unit_amount / (intervalCount * 12);
  return null;
}

type PriceResolvido = { unitAmount: number; rotulo: string; mensalEquivalente: number | null };

// Busca o preço de verdade no Stripe (nunca duplicado aqui, mesmo espírito
// já documentado em planos.ts) pra TODOS os intervalos configurados de cada
// plano — se uma busca falhar por qualquer motivo (Price apagado, Stripe
// fora do ar), aquele intervalo simplesmente não aparece, nunca quebra os
// outros intervalos nem a página.
export async function anexarPrecos(planos: Plano[]): Promise<PlanoComPreco[]> {
  const stripe = obterStripe();

  return Promise.all(
    planos.map(async (plano) => {
      const resolvidos = await Promise.all(
        INTERVALOS.map(async (intervalo): Promise<[Intervalo, PriceResolvido | null]> => {
          const priceId = plano.precosPorIntervalo[intervalo];
          if (!priceId) return [intervalo, null];
          try {
            const price = await stripe.prices.retrieve(priceId);
            if (price.unit_amount === null || !price.recurring) return [intervalo, null];
            return [
              intervalo,
              {
                unitAmount: price.unit_amount,
                rotulo: rotularIntervalo(price.recurring),
                mensalEquivalente: valorMensalEquivalente(price),
              },
            ];
          } catch {
            return [intervalo, null];
          }
        })
      );

      const porIntervalo = Object.fromEntries(resolvidos) as Record<Intervalo, PriceResolvido | null>;
      const baseMensal = porIntervalo.mensal?.mensalEquivalente ?? null;

      const precos: Partial<Record<Intervalo, PrecoIntervalo>> = {};
      for (const [intervalo, dados] of resolvidos) {
        if (!dados) continue;
        const economiaPercentual =
          intervalo !== "mensal" && baseMensal && dados.mensalEquivalente
            ? Math.round((1 - dados.mensalEquivalente / baseMensal) * 100)
            : null;
        precos[intervalo] = {
          precoFormatado: `${formatoMoeda.format(dados.unitAmount / 100)}${dados.rotulo}`,
          economiaPercentual,
        };
      }

      return { ...plano, precos };
    })
  );
}
