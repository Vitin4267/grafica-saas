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

  it("em caso de empate na distância, prevalece o MAIOR precoKg (achado 6a)", () => {
    // 120 está exatamente a 30 de distância tanto de 90 quanto de 150. Nesta
    // tabela a linha de 150g também tem o precoKg maior (13.4 > 12.5), então
    // o resultado coincide com o que o critério antigo (maior gramatura)
    // devolvia — mas o motivo agora é outro: ver o teste seguinte, que usa
    // uma tabela onde os dois critérios DIVERGEM, pra provar que é
    // precoKg que decide, não gramatura.
    const resultado = resolverPrecoPapel(TABELA_COUCHE, 120);
    expect(resultado).toEqual({ precoKg: 13.4, gramaturaBase: 150, origem: "APROXIMADO" });
  });

  it("em empate de distância, escolhe a linha de MAIOR precoKg mesmo quando é a de MENOR gramatura (achado 6a)", () => {
    // Gramatura digitada 150; tabela com 120g a R$12,50/kg e 180g a
    // R$11,80/kg — empate de distância: |150-120|=30=|150-180|=30. Em
    // tabela de papel o R$/kg CAI conforme a gramatura sobe (papel mais
    // grosso é mais barato por kg), então a linha de 180g é a mais BARATA —
    // usá-la subestimaria o custo do papel. O critério antigo (maior
    // gramatura) escolhia 180g/R$11,80; o correto é a linha mais CARA
    // (maior precoKg), que protege a margem de verdade: 120g/R$12,50.
    const tabela = [
      { gramatura: 120, precoKg: 12.5 },
      { gramatura: 180, precoKg: 11.8 },
    ];
    const resultado = resolverPrecoPapel(tabela, 150);
    expect(resultado).toEqual({ precoKg: 12.5, gramaturaBase: 120, origem: "APROXIMADO" });
  });

  it("no fallback, ignora linha com precoKg<=0 mesmo quando é a gramatura mais próxima (achado 6b)", () => {
    // 90g cadastrado sem preço (precoKg=0) e 115g a R$9,80/kg. Gramatura
    // pedida 100: distância pra 90g é 10, pra 115g é 15 — 90g venceria pela
    // distância sozinha, mas tem preço inválido e não é candidata válida.
    // 115g, mesmo mais longe, é a única linha com preço utilizável e deve
    // ser escolhida — em vez de devolver preço zero e derrubar o orçamento
    // em CUSTO_INVALIDO lá na frente.
    const tabela = [
      { gramatura: 90, precoKg: 0 },
      { gramatura: 115, precoKg: 9.8 },
    ];
    const resultado = resolverPrecoPapel(tabela, 100);
    expect(resultado).toEqual({ precoKg: 9.8, gramaturaBase: 115, origem: "APROXIMADO" });
  });

  it("se TODAS as linhas tiverem precoKg<=0, o fallback continua devolvendo a mais próxima (comportamento total inalterado)", () => {
    // Sem nenhuma linha com preço válido, não há alternativa melhor — o
    // fallback volta a considerar a tabela inteira e devolve a mais
    // próxima por gramatura, preço zero e tudo, deixando o CUSTO_INVALIDO
    // acontecer adiante como já acontecia antes do achado 6b.
    const tabela = [
      { gramatura: 90, precoKg: 0 },
      { gramatura: 200, precoKg: 0 },
    ];
    const resultado = resolverPrecoPapel(tabela, 100);
    expect(resultado).toEqual({ precoKg: 0, gramaturaBase: 90, origem: "APROXIMADO" });
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
