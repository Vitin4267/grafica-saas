import { describe, it, expect } from "vitest";
import { resolverLimiteImportacaoMes, LIMITE_IMPORTACAO_MES, LIMITE_IMPORTACAO_TRIAL } from "./limite-importacao";

describe("resolverLimiteImportacaoMes", () => {
  it("TRIALING sem plano dá 1 importação/mês", () => {
    expect(resolverLimiteImportacaoMes({ status: "TRIALING", cortesia: false, planoId: null })).toBe(
      LIMITE_IMPORTACAO_TRIAL
    );
  });

  it("básico dá 5/mês, pro dá 15/mês, empresarial ilimitado", () => {
    expect(resolverLimiteImportacaoMes({ status: "ATIVA", cortesia: false, planoId: "basico" })).toBe(
      LIMITE_IMPORTACAO_MES.basico
    );
    expect(resolverLimiteImportacaoMes({ status: "ATIVA", cortesia: false, planoId: "pro" })).toBe(
      LIMITE_IMPORTACAO_MES.pro
    );
    expect(resolverLimiteImportacaoMes({ status: "ATIVA", cortesia: false, planoId: "empresarial" })).toBeNull();
  });

  it("cortesia libera ilimitado independente de status/plano", () => {
    expect(resolverLimiteImportacaoMes({ status: "CANCELADA", cortesia: true, planoId: null })).toBeNull();
  });

  it("plano desconhecido (price ausente) e sem trial: sem cota (fail-closed)", () => {
    expect(resolverLimiteImportacaoMes({ status: "ATIVA", cortesia: false, planoId: null })).toBe(0);
  });

  it("INADIMPLENTE/CANCELADA sem cortesia: sem cota", () => {
    expect(resolverLimiteImportacaoMes({ status: "INADIMPLENTE", cortesia: false, planoId: null })).toBe(0);
    expect(resolverLimiteImportacaoMes({ status: "CANCELADA", cortesia: false, planoId: "pro" })).toBe(
      LIMITE_IMPORTACAO_MES.pro
    );
  });
});
