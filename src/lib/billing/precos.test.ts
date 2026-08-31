import { describe, it, expect, vi, beforeEach } from "vitest";
import { anexarPrecos } from "./precos";
import type { Plano } from "./planos";

// obterStripe() cria um client Stripe de verdade (precisa de
// STRIPE_SECRET_KEY) — mockado aqui pra testar anexarPrecos sem rede,
// controlando exatamente o que stripe.prices.retrieve devolve.
const retrieveMock = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  obterStripe: () => ({ prices: { retrieve: retrieveMock } }),
}));

type PriceFake = { unit_amount: number | null; recurring: { interval: string; interval_count: number } | null };

function price(overrides: Partial<PriceFake> = {}): PriceFake {
  return {
    unit_amount: 74990,
    recurring: { interval: "month", interval_count: 1 },
    ...overrides,
  };
}

function plano(overrides: Partial<Plano> = {}): Plano {
  return {
    id: "basico",
    nome: "Básico",
    precosPorIntervalo: { mensal: "price_mensal", semestral: null, anual: null },
    descricao: "desc",
    limiteOrcamentosMes: 90,
    limiteUsuarios: 2,
    limiteArmazenamentoMb: 5 * 1024,
    ...overrides,
  };
}

beforeEach(() => {
  retrieveMock.mockReset();
});

describe("anexarPrecos", () => {
  it("resolve o preço mensal com o rótulo '/mês' e sem economia (é a base)", async () => {
    retrieveMock.mockResolvedValueOnce(price({ unit_amount: 74990 }));

    const [resultado] = await anexarPrecos([plano()]);

    expect(resultado.precos.mensal?.precoFormatado).toMatch(/749,90/);
    expect(resultado.precos.mensal?.precoFormatado).toMatch(/\/mês$/);
    expect(resultado.precos.mensal?.economiaPercentual).toBeNull();
  });

  // Pegadinha real do Stripe: "a cada 6 meses" é interval:"month" +
  // interval_count:6, não existe interval:"semester". Sem tratar
  // interval_count, isso seria rotulado errado como "/mês".
  it("rotula um Price semestral (interval:'month', interval_count:6) como '/semestre', não '/mês'", async () => {
    retrieveMock
      .mockResolvedValueOnce(price({ unit_amount: 74990, recurring: { interval: "month", interval_count: 1 } }))
      .mockResolvedValueOnce(price({ unit_amount: 382449, recurring: { interval: "month", interval_count: 6 } }));

    const [resultado] = await anexarPrecos([
      plano({ precosPorIntervalo: { mensal: "price_mensal", semestral: "price_semestral", anual: null } }),
    ]);

    expect(resultado.precos.semestral?.precoFormatado).toMatch(/\/semestre$/);
    expect(resultado.precos.semestral?.precoFormatado).not.toMatch(/\/mês$/);
  });

  it("calcula a economia do semestral comparando o mensal-equivalente real com o preço mensal (~15%)", async () => {
    // 749,90/mês; semestral = 749,90 * 6 * 0,85 = 3.824,49 (15% off)
    retrieveMock
      .mockResolvedValueOnce(price({ unit_amount: 74990, recurring: { interval: "month", interval_count: 1 } }))
      .mockResolvedValueOnce(price({ unit_amount: 382449, recurring: { interval: "month", interval_count: 6 } }));

    const [resultado] = await anexarPrecos([
      plano({ precosPorIntervalo: { mensal: "price_mensal", semestral: "price_semestral", anual: null } }),
    ]);

    expect(resultado.precos.semestral?.economiaPercentual).toBe(15);
  });

  it("calcula a economia do anual comparando o mensal-equivalente real (unit_amount/12) com o mensal (~20%)", async () => {
    // 749,90/mês; anual = 749,90 * 12 * 0,80 = 7.199,04 (20% off)
    retrieveMock
      .mockResolvedValueOnce(price({ unit_amount: 74990, recurring: { interval: "month", interval_count: 1 } }))
      .mockResolvedValueOnce(price({ unit_amount: 719904, recurring: { interval: "year", interval_count: 1 } }));

    const [resultado] = await anexarPrecos([
      plano({ precosPorIntervalo: { mensal: "price_mensal", semestral: null, anual: "price_anual" } }),
    ]);

    expect(resultado.precos.anual?.precoFormatado).toMatch(/\/ano$/);
    expect(resultado.precos.anual?.economiaPercentual).toBe(20);
  });

  it("nunca hardcoda 15%/20% — economia reflete o valor real configurado no Stripe, mesmo se divergir da decisão de negócio", async () => {
    // Configurado errado no Stripe (só 5% de desconto) — o texto tem que
    // bater com a realidade, não com o que foi decidido.
    retrieveMock
      .mockResolvedValueOnce(price({ unit_amount: 100000, recurring: { interval: "month", interval_count: 1 } }))
      .mockResolvedValueOnce(price({ unit_amount: 1140000, recurring: { interval: "year", interval_count: 1 } }));

    const [resultado] = await anexarPrecos([
      plano({ precosPorIntervalo: { mensal: "price_mensal", semestral: null, anual: "price_anual" } }),
    ]);

    // mensal-equivalente do anual = 1140000/12 = 95000; economia = 1 - 95000/100000 = 5%
    expect(resultado.precos.anual?.economiaPercentual).toBe(5);
  });

  it("intervalo sem env var configurada (price id null) não aparece em `precos`", async () => {
    retrieveMock.mockResolvedValueOnce(price({ unit_amount: 74990 }));

    const [resultado] = await anexarPrecos([plano()]); // só mensal configurado

    expect(resultado.precos.mensal).toBeDefined();
    expect(resultado.precos.semestral).toBeUndefined();
    expect(resultado.precos.anual).toBeUndefined();
    expect(retrieveMock).toHaveBeenCalledTimes(1);
  });

  it("Price apagado/erro do Stripe num intervalo não quebra os outros nem a página", async () => {
    retrieveMock
      .mockResolvedValueOnce(price({ unit_amount: 74990 }))
      .mockRejectedValueOnce(new Error("No such price"));

    const [resultado] = await anexarPrecos([
      plano({ precosPorIntervalo: { mensal: "price_mensal", semestral: "price_apagado", anual: null } }),
    ]);

    expect(resultado.precos.mensal).toBeDefined();
    expect(resultado.precos.semestral).toBeUndefined();
  });

  it("unit_amount nulo (Price sem valor definido) trata como intervalo indisponível", async () => {
    retrieveMock.mockResolvedValueOnce(price({ unit_amount: null }));

    const [resultado] = await anexarPrecos([plano()]);

    expect(resultado.precos.mensal).toBeUndefined();
  });
});
