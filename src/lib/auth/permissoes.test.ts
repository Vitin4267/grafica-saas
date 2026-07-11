import { describe, it, expect } from "vitest";
import { podeVerMeuNegocio } from "./permissoes";

describe("podeVerMeuNegocio", () => {
  it("DONO sempre vê, mesmo sem compartilhamento nem acesso individual", () => {
    expect(
      podeVerMeuNegocio({
        papel: "DONO",
        acessoMeuNegocio: false,
        grafica: { compartilharMeuNegocio: false },
      })
    ).toBe(true);
  });

  it("não-DONO só vê com compartilhamento da gráfica E acesso individual", () => {
    expect(
      podeVerMeuNegocio({
        papel: "OPERADOR",
        acessoMeuNegocio: true,
        grafica: { compartilharMeuNegocio: true },
      })
    ).toBe(true);
  });

  it("não-DONO com acesso individual mas SEM compartilhamento geral não vê", () => {
    expect(
      podeVerMeuNegocio({
        papel: "OPERADOR",
        acessoMeuNegocio: true,
        grafica: { compartilharMeuNegocio: false },
      })
    ).toBe(false);
  });

  it("não-DONO com compartilhamento geral mas SEM acesso individual não vê", () => {
    expect(
      podeVerMeuNegocio({
        papel: "ADMIN",
        acessoMeuNegocio: false,
        grafica: { compartilharMeuNegocio: true },
      })
    ).toBe(false);
  });

  it("não-DONO sem nenhum dos dois não vê", () => {
    expect(
      podeVerMeuNegocio({
        papel: "OPERADOR",
        acessoMeuNegocio: false,
        grafica: { compartilharMeuNegocio: false },
      })
    ).toBe(false);
  });
});
