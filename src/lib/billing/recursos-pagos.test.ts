import { describe, it, expect } from "vitest";
import {
  podeUsarRecursoPago,
  mensagemRecursoBloqueado,
  RECURSOS_PAGOS,
  ORDEM_PLANOS,
  type RecursoPago,
} from "./recursos-pagos";

describe("podeUsarRecursoPago", () => {
  it("libera plano Pro", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "ATIVA",
      cortesia: false,
      planoId: "pro",
    });
    expect(resultado.liberado).toBe(true);
  });

  it("libera plano Empresarial", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "ATIVA",
      cortesia: false,
      planoId: "empresarial",
    });
    expect(resultado.liberado).toBe(true);
  });

  it("bloqueia plano Básico com motivo 'plano' (requisito principal do dono do produto)", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "ATIVA",
      cortesia: false,
      planoId: "basico",
    });
    expect(resultado.liberado).toBe(false);
    if (!resultado.liberado) {
      expect(resultado.motivo).toBe("plano");
      expect(resultado.mensagem).toBe("Disponível a partir do plano Pro.");
    }
  });

  it("bloqueia TRIALING mesmo sem plano nenhum, motivo 'assinatura' (decisão: sem amostra grátis no trial)", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "TRIALING",
      cortesia: false,
      planoId: null,
    });
    expect(resultado.liberado).toBe(false);
    if (!resultado.liberado) expect(resultado.motivo).toBe("assinatura");
  });

  it("bloqueia TRIALING mesmo se um planoId elegível estivesse presente (status checado independente do plano)", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "TRIALING",
      cortesia: false,
      planoId: "pro",
    });
    expect(resultado.liberado).toBe(false);
  });

  it("bloqueia INADIMPLENTE", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "INADIMPLENTE",
      cortesia: false,
      planoId: "pro",
    });
    expect(resultado.liberado).toBe(false);
  });

  it("bloqueia CANCELADA", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "CANCELADA",
      cortesia: false,
      planoId: "pro",
    });
    expect(resultado.liberado).toBe(false);
  });

  it("bloqueia sem assinatura nenhuma (status null)", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: null,
      cortesia: false,
      planoId: null,
    });
    expect(resultado.liberado).toBe(false);
  });

  it("cortesia libera mesmo sem planoId reconhecido (override soberano)", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "ATIVA",
      cortesia: true,
      planoId: null,
    });
    expect(resultado.liberado).toBe(true);
  });

  it("cortesia libera mesmo com status ruim (mesma regra de assinaturaEstaLiberada)", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "CANCELADA",
      cortesia: true,
      planoId: null,
    });
    expect(resultado.liberado).toBe(true);
  });

  it("falha fechado: ATIVA com planoId null (price desconhecido/env var faltando) bloqueia — diferente de limiteExcedido, que falha aberto", () => {
    const resultado = podeUsarRecursoPago("calculo_tinta_ia", {
      status: "ATIVA",
      cortesia: false,
      planoId: null,
    });
    expect(resultado.liberado).toBe(false);
  });
});

describe("mensagemRecursoBloqueado", () => {
  it("plural: 'a partir de' quando mais de um plano é elegível", () => {
    expect(mensagemRecursoBloqueado("calculo_tinta_ia")).toBe("Disponível a partir do plano Pro.");
  });
});

describe("RECURSOS_PAGOS (invariantes da tabela)", () => {
  const recursos = Object.keys(RECURSOS_PAGOS) as RecursoPago[];

  it("todo recurso declara pelo menos um plano elegível", () => {
    for (const recurso of recursos) {
      expect(RECURSOS_PAGOS[recurso].length).toBeGreaterThan(0);
    }
  });

  it("todo plano declarado existe em ORDEM_PLANOS", () => {
    for (const recurso of recursos) {
      for (const plano of RECURSOS_PAGOS[recurso]) {
        expect(ORDEM_PLANOS).toContain(plano);
      }
    }
  });

  it("planos elegíveis são sempre um sufixo contíguo de ORDEM_PLANOS (nunca pula um plano do meio)", () => {
    for (const recurso of recursos) {
      const elegiveis = RECURSOS_PAGOS[recurso];
      const indiceMaisBarato = ORDEM_PLANOS.findIndex((p) => elegiveis.includes(p));
      const sufixoEsperado = ORDEM_PLANOS.slice(indiceMaisBarato);
      expect([...elegiveis].sort()).toEqual([...sufixoEsperado].sort());
    }
  });
});
