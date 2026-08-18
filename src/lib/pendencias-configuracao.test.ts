import { describe, it, expect, vi, beforeEach } from "vitest";

// Teste de lógica pura — sem Postgres real. prisma.itemGrafica.findMany é
// chamado 1x pro check de bobina e, quando count() devolve 0, mais 1x pro
// check de papel/clichê (mesma ordem de listarPendenciasConfiguracao) —
// os mocks abaixo usam essa ordem via mockResolvedValueOnce em sequência.
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

    const pendencias = await listarPendenciasConfiguracao("grafica-1");

    expect(pendencias).toEqual([]);
    // count=1 destrava o early-out: não precisa buscar produtos com clichê
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("detecta bobina de etiqueta faltando", async () => {
    findManyMock.mockResolvedValueOnce([
      { id: "item-bobina-1", itemCatalogo: { nome: "Etiqueta Redonda 5cm" } },
    ]);
    countMock.mockResolvedValueOnce(1);

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

    const pendencias = await listarPendenciasConfiguracao("grafica-1");

    expect(pendencias).toEqual([
      {
        tipo: "PAPEL_MATERIA_PRIMA_FALTANDO",
        itemGraficaId: "item-cliche-1",
        nomeProduto: "Etiqueta com Clichê",
      },
    ]);
  });

  it("combina as duas pendências quando ambas se aplicam", async () => {
    findManyMock.mockResolvedValueOnce([
      { id: "item-bobina-1", itemCatalogo: { nome: "Etiqueta Redonda" } },
    ]);
    countMock.mockResolvedValueOnce(0);
    findManyMock.mockResolvedValueOnce([
      { id: "item-cliche-1", itemCatalogo: { nome: "Etiqueta com Clichê" } },
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
    ]);
  });
});
