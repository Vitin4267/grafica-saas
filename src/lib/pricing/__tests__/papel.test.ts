import { describe, expect, it } from "vitest";
import { resolverPrecoPapel } from "../papel";
import { ErroPrecificacao } from "../erros";

const TABELA_COUCHE = [
  { gramatura: 90, precoKg: 12.5 },
  { gramatura: 150, precoKg: 13.4 },
  { gramatura: 300, precoKg: 15.6 },
];

describe("resolverPrecoPapel", () => {
  it("retorna o preço exato quando a gramatura está cadastrada", () => {
    const resultado = resolverPrecoPapel(TABELA_COUCHE, 150);
    expect(resultado).toEqual({ precoKg: 13.4, gramaturaBase: 150, origem: "EXATO" });
  });

  it("cai no fallback pela gramatura mais próxima quando não há match exato", () => {
    // 100 está a 10 de distância de 90 e a 50 de 150 — 90 vence sem empate.
    const resultado = resolverPrecoPapel(TABELA_COUCHE, 100);
    expect(resultado).toEqual({ precoKg: 12.5, gramaturaBase: 90, origem: "APROXIMADO" });
  });

  it("em caso de empate na distância, prevalece a MAIOR gramatura", () => {
    // 120 está exatamente a 30 de distância tanto de 90 quanto de 150.
    const resultado = resolverPrecoPapel(TABELA_COUCHE, 120);
    expect(resultado).toEqual({ precoKg: 13.4, gramaturaBase: 150, origem: "APROXIMADO" });
  });

  it("nunca lança erro por gramatura exótica, mesmo bem fora da faixa cadastrada", () => {
    expect(() => resolverPrecoPapel(TABELA_COUCHE, 500)).not.toThrow();
    const resultado = resolverPrecoPapel(TABELA_COUCHE, 500);
    expect(resultado.origem).toBe("APROXIMADO");
    expect(resultado.gramaturaBase).toBe(300);
  });

  it("lança ErroPrecificacao com código PAPEL_SEM_TABELA_PRECO quando a tabela está vazia", () => {
    expect(() => resolverPrecoPapel([], 150)).toThrow(ErroPrecificacao);
    try {
      resolverPrecoPapel([], 150);
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroPrecificacao);
      expect((erro as ErroPrecificacao).codigo).toBe("PAPEL_SEM_TABELA_PRECO");
    }
  });
});
