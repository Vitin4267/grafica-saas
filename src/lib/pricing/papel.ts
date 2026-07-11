import { ErroPrecificacao } from "./erros";

export type OrigemPrecoPapel = "EXATO" | "APROXIMADO";

export type LinhaTabelaPapel = { gramatura: number; precoKg: number };

export type ResultadoPrecoPapel = {
  precoKg: number;
  gramaturaBase: number;
  origem: OrigemPrecoPapel;
};

// Busca o preço/kg de um papel pela gramatura escolhida no produto. Nunca
// retorna zero e nunca lança erro por gramatura "exótica" — só lança quando
// o papel em si não tem nenhuma linha de preço cadastrada (ver PAPEL_SEM_TABELA_PRECO).
// Estratégia: match exato -> fallback pela menor distância absoluta, com
// empate resolvido pra MAIOR gramatura (protege a margem da gráfica).
export function resolverPrecoPapel(
  tabela: LinhaTabelaPapel[],
  gramaturaDigitada: number
): ResultadoPrecoPapel {
  const exata = tabela.find((linha) => linha.gramatura === gramaturaDigitada);
  if (exata) {
    return { precoKg: exata.precoKg, gramaturaBase: exata.gramatura, origem: "EXATO" };
  }

  if (tabela.length === 0) {
    throw new ErroPrecificacao(
      "PAPEL_SEM_TABELA_PRECO",
      "Este papel ainda não tem preços cadastrados — cadastre ao menos uma gramatura no catálogo antes de orçar."
    );
  }

  const maisProxima = tabela.reduce((melhor, atual) => {
    const distAtual = Math.abs(atual.gramatura - gramaturaDigitada);
    const distMelhor = Math.abs(melhor.gramatura - gramaturaDigitada);
    if (distAtual < distMelhor) return atual;
    if (distAtual === distMelhor && atual.gramatura > melhor.gramatura) return atual;
    return melhor;
  });

  return { precoKg: maisProxima.precoKg, gramaturaBase: maisProxima.gramatura, origem: "APROXIMADO" };
}
