import { describe, it, expect } from "vitest";
import { agruparClientesPorDocumento, type ClienteParaDuplicidade } from "./clientes-duplicados";

function cliente(
  id: string,
  nome: string,
  documento: string | null,
  desativadoEm: Date | null = null
): ClienteParaDuplicidade {
  return { id, nome, documento, desativadoEm };
}

describe("agruparClientesPorDocumento", () => {
  it("agrupa dois clientes com o mesmo documento, só com pontuação diferente", () => {
    const grupos = agruparClientesPorDocumento([
      cliente("1", "Fulano", "111.444.777-35"),
      cliente("2", "Fulano de Tal (duplicado)", "11144477735"),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].documentoNormalizado).toBe("11144477735");
    expect(grupos[0].clientes.map((c) => c.id).sort()).toEqual(["1", "2"]);
  });

  it("não agrupa clientes com documentos diferentes", () => {
    const grupos = agruparClientesPorDocumento([
      cliente("1", "Fulano", "111.444.777-35"),
      cliente("2", "Beltrano", "11.222.333/0001-81"),
    ]);
    expect(grupos).toHaveLength(0);
  });

  it("ignora clientes sem documento (null ou vazio)", () => {
    const grupos = agruparClientesPorDocumento([
      cliente("1", "Sem documento A", null),
      cliente("2", "Sem documento B", ""),
      cliente("3", "Sem documento C", null),
    ]);
    expect(grupos).toHaveLength(0);
  });

  it("um único cliente com um documento nunca é um grupo", () => {
    const grupos = agruparClientesPorDocumento([cliente("1", "Fulano", "111.444.777-35")]);
    expect(grupos).toHaveLength(0);
  });

  it("agrupa 3+ clientes com o mesmo documento normalizado", () => {
    const grupos = agruparClientesPorDocumento([
      cliente("1", "Fulano", "11144477735"),
      cliente("2", "Fulano LTDA", "111.444.777-35"),
      cliente("3", "Fulano (velho)", "111 444 777 35"),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].clientes).toHaveLength(3);
  });

  it("grupos maiores aparecem primeiro", () => {
    const grupos = agruparClientesPorDocumento([
      cliente("1", "A1", "11.222.333/0001-81"),
      cliente("2", "A2", "11222333000181"),
      cliente("3", "B1", "111.444.777-35"),
      cliente("4", "B2", "11144477735"),
      cliente("5", "B3", "111 444 777 35"),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos[0].clientes).toHaveLength(3); // grupo do CPF (3 clientes) vem antes
    expect(grupos[1].clientes).toHaveLength(2); // grupo do CNPJ (2 clientes)
  });

  it("preserva o desativadoEm de cada cliente do grupo (pra UI distinguir ativo/desativado)", () => {
    const desativadoEm = new Date("2026-01-01T00:00:00Z");
    const grupos = agruparClientesPorDocumento([
      cliente("1", "Ativo", "111.444.777-35"),
      cliente("2", "Desativado", "11144477735", desativadoEm),
    ]);
    expect(grupos[0].clientes.find((c) => c.id === "2")?.desativadoEm).toEqual(desativadoEm);
  });
});
