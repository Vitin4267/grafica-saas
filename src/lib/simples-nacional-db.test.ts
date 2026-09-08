import { describe, it, expect, vi, beforeEach } from "vitest";

const aggregateMock = vi.fn();
const dadosFiscaisFindUniqueMock = vi.fn();
const parametrosFindUniqueMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orcamento: {
      aggregate: (...args: unknown[]) => aggregateMock(...args),
    },
    dadosFiscaisGrafica: {
      findUnique: (...args: unknown[]) => dadosFiscaisFindUniqueMock(...args),
    },
    parametrosGrafica: {
      findUnique: (...args: unknown[]) => parametrosFindUniqueMock(...args),
    },
  },
}));

import { calcularRbt12, calcularSituacaoAliquotaSimples } from "./simples-nacional-db";

describe("calcularRbt12", () => {
  beforeEach(() => {
    aggregateMock.mockReset();
  });

  it("soma Orcamento aprovado dos últimos 12 meses, excluindo pedido cancelado", async () => {
    aggregateMock.mockResolvedValueOnce({ _sum: { total: "250000.00" } });

    const rbt12 = await calcularRbt12("grafica-1");

    expect(rbt12).toBe(250_000);
    const chamada = aggregateMock.mock.calls[0][0];
    expect(chamada.where.graficaId).toBe("grafica-1");
    expect(chamada.where.status).toBe("APROVADO");
    expect(chamada.where.NOT).toEqual({ pedido: { status: "CANCELADO" } });
  });

  it("sem nenhum orçamento aprovado no período: devolve 0", async () => {
    aggregateMock.mockResolvedValueOnce({ _sum: { total: null } });

    const rbt12 = await calcularRbt12("grafica-1");

    expect(rbt12).toBe(0);
  });
});

describe("calcularSituacaoAliquotaSimples", () => {
  beforeEach(() => {
    aggregateMock.mockReset();
    dadosFiscaisFindUniqueMock.mockReset();
    parametrosFindUniqueMock.mockReset();
  });

  it("regime != SIMPLES_NACIONAL: devolve null (não se aplica)", async () => {
    dadosFiscaisFindUniqueMock.mockResolvedValueOnce({ regimeTributario: "LUCRO_PRESUMIDO" });
    parametrosFindUniqueMock.mockResolvedValueOnce({ impostoPercent: "0.06" });

    const resultado = await calcularSituacaoAliquotaSimples("grafica-1");

    expect(resultado).toBeNull();
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  it("DadosFiscaisGrafica ainda não cadastrado: devolve null", async () => {
    dadosFiscaisFindUniqueMock.mockResolvedValueOnce(null);
    parametrosFindUniqueMock.mockResolvedValueOnce({ impostoPercent: "0.06" });

    const resultado = await calcularSituacaoAliquotaSimples("grafica-1");

    expect(resultado).toBeNull();
  });

  it("Simples Nacional com RBT12 baixo: alíquota efetiva igual ao default (sem alerta implícito aqui, comparação é de quem chama)", async () => {
    dadosFiscaisFindUniqueMock.mockResolvedValueOnce({ regimeTributario: "SIMPLES_NACIONAL" });
    parametrosFindUniqueMock.mockResolvedValueOnce({ impostoPercent: "0.06" });
    aggregateMock.mockResolvedValueOnce({ _sum: { total: "100000.00" } });

    const resultado = await calcularSituacaoAliquotaSimples("grafica-1");

    expect(resultado).not.toBeNull();
    expect(resultado?.rbt12).toBe(100_000);
    expect(resultado?.aliquotaEfetiva).toBeCloseTo(0.06, 6);
    expect(resultado?.impostoConfigurado).toBeCloseTo(0.06, 6);
  });

  it("Simples Nacional com RBT12 alto: alíquota efetiva calculada acima do configurado", async () => {
    dadosFiscaisFindUniqueMock.mockResolvedValueOnce({ regimeTributario: "SIMPLES_NACIONAL" });
    parametrosFindUniqueMock.mockResolvedValueOnce({ impostoPercent: "0.06" });
    aggregateMock.mockResolvedValueOnce({ _sum: { total: "500000.00" } });

    const resultado = await calcularSituacaoAliquotaSimples("grafica-1");

    expect(resultado).not.toBeNull();
    expect(resultado?.rbt12).toBe(500_000);
    expect(resultado?.faixaIndice).toBe(2);
    expect(resultado!.aliquotaEfetiva).toBeGreaterThan(resultado!.impostoConfigurado);
  });
});
