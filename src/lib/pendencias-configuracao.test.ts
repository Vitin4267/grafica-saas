import { describe, it, expect, vi, beforeEach } from "vitest";

// Teste de lógica pura — sem Postgres real. prisma.itemGrafica.findMany é
// chamado 1x pro check de bobina, mais 1x pro check de papel/clichê SE
// count() devolver 0 (senão early-out), e sempre mais 1x pro check de
// máquina não vinculada (achado A6 da Parte 6 da auditoria de abrangência,
// 2026-08-27 — vale pra qualquer segmento, sem early-out) — mesma ordem de
// listarPendenciasConfiguracao. Os mocks abaixo usam essa ordem via
// mockResolvedValueOnce em sequência.
const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    itemGrafica: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

import { listarPendenciasConfiguracao } from "./pendencias-configuracao";

describe("listarPendenciasConfiguracao", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    countMock.mockReset();
  });

  it("retorna array vazio quando não há pendência nenhuma", async () => {
    findManyMock.mockResolvedValueOnce([]); // bobina: nenhum produto sem bobina
    countMock.mockResolvedValueOnce(1); // já tem matéria-prima cadastrada
    findManyMock.mockResolvedValueOnce([]); // máquina: nenhum produto sem máquina vinculada

    const pendencias = await listarPendenciasConfiguracao("grafica-1");

    expect(pendencias).toEqual([]);
    // count=1 destrava o early-out do check de papel: não precisa buscar
    // produtos com clichê, mas o check de máquina roda sempre — 2 findMany.
    expect(findManyMock).toHaveBeenCalledTimes(2);
  });

  it("detecta bobina de etiqueta faltando", async () => {
    findManyMock.mockResolvedValueOnce([
      { id: "item-bobina-1", itemCatalogo: { nome: "Etiqueta Redonda 5cm" } },
    ]);
    countMock.mockResolvedValueOnce(1);
    findManyMock.mockResolvedValueOnce([]);

    const pendencias = await listarPendenciasConfiguracao("grafica-1");

    expect(pendencias).toEqual([
      {
        tipo: "BOBINA_ETIQUETA_FALTANDO",
        itemGraficaId: "item-bobina-1",
        nomeProduto: "Etiqueta Redonda 5cm",
      },
    ]);
  });

  it("detecta papel de matéria-prima faltando para produto com clichê", async () => {
    findManyMock.mockResolvedValueOnce([]); // bobina: ok
    countMock.mockResolvedValueOnce(0); // nenhuma matéria-prima ativa na gráfica
    findManyMock.mockResolvedValueOnce([
      { id: "item-cliche-1", itemCatalogo: { nome: "Etiqueta com Clichê" } },
    ]);
    findManyMock.mockResolvedValueOnce([]); // máquina: ok

    const pendencias = await listarPendenciasConfiguracao("grafica-1");

    expect(pendencias).toEqual([
      {
        tipo: "PAPEL_MATERIA_PRIMA_FALTANDO",
        itemGraficaId: "item-cliche-1",
        nomeProduto: "Etiqueta com Clichê",
      },
    ]);
  });

  it("detecta produto sem máquina vinculada (ex: OFFSET sem prensa)", async () => {
    findManyMock.mockResolvedValueOnce([]); // bobina: ok
    countMock.mockResolvedValueOnce(1); // early-out do check de papel
    findManyMock.mockResolvedValueOnce([
      { id: "item-offset-1", itemCatalogo: { nome: "Cartão de Visita" } },
    ]);

    const pendencias = await listarPendenciasConfiguracao("grafica-1");

    expect(pendencias).toEqual([
      {
        tipo: "MAQUINA_NAO_VINCULADA",
        itemGraficaId: "item-offset-1",
        nomeProduto: "Cartão de Visita",
      },
    ]);
  });

  it("combina as três pendências quando todas se aplicam", async () => {
    findManyMock.mockResolvedValueOnce([
      { id: "item-bobina-1", itemCatalogo: { nome: "Etiqueta Redonda" } },
    ]);
    countMock.mockResolvedValueOnce(0);
    findManyMock.mockResolvedValueOnce([
      { id: "item-cliche-1", itemCatalogo: { nome: "Etiqueta com Clichê" } },
    ]);
    findManyMock.mockResolvedValueOnce([
      { id: "item-serigrafia-1", itemCatalogo: { nome: "Camiseta Estampada" } },
    ]);

    const pendencias = await listarPendenciasConfiguracao("grafica-1");

    expect(pendencias).toEqual([
      {
        tipo: "BOBINA_ETIQUETA_FALTANDO",
        itemGraficaId: "item-bobina-1",
        nomeProduto: "Etiqueta Redonda",
      },
      {
        tipo: "PAPEL_MATERIA_PRIMA_FALTANDO",
        itemGraficaId: "item-cliche-1",
        nomeProduto: "Etiqueta com Clichê",
      },
      {
        tipo: "MAQUINA_NAO_VINCULADA",
        itemGraficaId: "item-serigrafia-1",
        nomeProduto: "Camiseta Estampada",
      },
    ]);
  });
});
