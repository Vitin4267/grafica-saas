import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { obterPlanos, obterPlano, obterPriceId, obterPlanoPorPriceId } from "./planos";

// Cobre a lógica nova de "3 intervalos por plano" adicionada pra suportar
// assinatura semestral/anual (além da mensal já existente): mensal continua
// obrigatório pro plano aparecer (mesmo comportamento de antes, quando só
// existia 1 intervalo), semestral/anual são opcionais por plano, e o reverse
// lookup (obterPlanoPorPriceId) precisa casar contra qualquer um dos 3.
const ENV_VARS = [
  "STRIPE_PRICE_ID_BASICO",
  "STRIPE_PRICE_ID_BASICO_SEMESTRAL",
  "STRIPE_PRICE_ID_BASICO_ANUAL",
  "STRIPE_PRICE_ID_PRO",
  "STRIPE_PRICE_ID_PRO_SEMESTRAL",
  "STRIPE_PRICE_ID_PRO_ANUAL",
  "STRIPE_PRICE_ID_EMPRESARIAL",
  "STRIPE_PRICE_ID_EMPRESARIAL_SEMESTRAL",
  "STRIPE_PRICE_ID_EMPRESARIAL_ANUAL",
] as const;

let backup: Record<string, string | undefined>;

beforeEach(() => {
  backup = {};
  for (const key of ENV_VARS) {
    backup[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_VARS) {
    if (backup[key] === undefined) delete process.env[key];
    else process.env[key] = backup[key];
  }
});

describe("obterPlanos", () => {
  it("sem nenhuma env var configurada, nenhum plano aparece (nunca quebra a página)", () => {
    expect(obterPlanos()).toEqual([]);
  });

  it("plano sem o Price MENSAL não aparece, mesmo com semestral/anual configurados", () => {
    process.env.STRIPE_PRICE_ID_BASICO_SEMESTRAL = "price_basico_semestral";
    process.env.STRIPE_PRICE_ID_BASICO_ANUAL = "price_basico_anual";
    expect(obterPlanos().find((p) => p.id === "basico")).toBeUndefined();
  });

  it("plano com só o mensal configurado aparece, com semestral/anual null", () => {
    process.env.STRIPE_PRICE_ID_BASICO = "price_basico_mensal";
    const plano = obterPlanos().find((p) => p.id === "basico");
    expect(plano?.precosPorIntervalo).toEqual({
      mensal: "price_basico_mensal",
      semestral: null,
      anual: null,
    });
  });

  it("plano com os 3 intervalos configurados traz os 3 price ids", () => {
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_mensal";
    process.env.STRIPE_PRICE_ID_PRO_SEMESTRAL = "price_pro_semestral";
    process.env.STRIPE_PRICE_ID_PRO_ANUAL = "price_pro_anual";
    const plano = obterPlanos().find((p) => p.id === "pro");
    expect(plano?.precosPorIntervalo).toEqual({
      mensal: "price_pro_mensal",
      semestral: "price_pro_semestral",
      anual: "price_pro_anual",
    });
  });
});

describe("obterPriceId", () => {
  it("resolve o price id do intervalo pedido quando configurado", () => {
    process.env.STRIPE_PRICE_ID_BASICO = "price_mensal";
    process.env.STRIPE_PRICE_ID_BASICO_ANUAL = "price_anual";
    expect(obterPriceId("basico", "mensal")).toBe("price_mensal");
    expect(obterPriceId("basico", "anual")).toBe("price_anual");
  });

  it("retorna null pra intervalo não configurado pra este plano", () => {
    process.env.STRIPE_PRICE_ID_BASICO = "price_mensal";
    expect(obterPriceId("basico", "semestral")).toBeNull();
  });
});

describe("obterPlano", () => {
  it("lança erro claro pra plano sem o Price mensal configurado", () => {
    expect(() => obterPlano("basico")).toThrow(/não está disponível/);
  });
});

describe("obterPlanoPorPriceId", () => {
  it("acha o plano casando pelo price mensal", () => {
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_mensal";
    expect(obterPlanoPorPriceId("price_pro_mensal")?.id).toBe("pro");
  });

  it("acha o plano casando pelo price semestral (não só pelo mensal)", () => {
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_mensal";
    process.env.STRIPE_PRICE_ID_PRO_SEMESTRAL = "price_pro_semestral";
    expect(obterPlanoPorPriceId("price_pro_semestral")?.id).toBe("pro");
  });

  it("acha o plano casando pelo price anual", () => {
    process.env.STRIPE_PRICE_ID_EMPRESARIAL = "price_emp_mensal";
    process.env.STRIPE_PRICE_ID_EMPRESARIAL_ANUAL = "price_emp_anual";
    expect(obterPlanoPorPriceId("price_emp_anual")?.id).toBe("empresarial");
  });

  it("retorna null pra price desconhecido (ex: grandfathered)", () => {
    process.env.STRIPE_PRICE_ID_BASICO = "price_mensal";
    expect(obterPlanoPorPriceId("price_desconhecido")).toBeNull();
  });

  it("retorna null pra stripePriceId nulo", () => {
    expect(obterPlanoPorPriceId(null)).toBeNull();
  });
});
