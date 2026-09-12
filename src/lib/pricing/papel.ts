import { ErroPrecificacao } from "./erros";

export type OrigemPrecoPapel = "EXATO" | "APROXIMADO";

export type LinhaTabelaPapel = { gramatura: number; precoKg: number };

export type ResultadoPrecoPapel = {
  precoKg: number;
  gramaturaBase: number;
  origem: OrigemPrecoPapel;
};

// Busca o preço/kg de um papel pela gramatura escolhida no produto. Nunca
// retorna zero (quando existe alternativa válida na tabela) e nunca lança
// erro por gramatura "exótica" — só lança quando o papel em si não tem
// nenhuma linha de preço cadastrada (ver PAPEL_SEM_TABELA_PRECO).
// Estratégia: match exato -> fallback pela menor distância absoluta de
// gramatura, IGNORANDO linhas com precoKg<=0 (acabou de gastar em achado 6b)
// e com empate de distância resolvido pelo MAIOR precoKg (achado 6a).
//
// Achado 6a (auditoria motor M2/Offset 2026-09-12) — o desempate ANTES ia
// pra maior gramatura, com o comentário dizendo que isso "protegia a
// margem". Mas em tabela de papel o R$/kg CAI conforme a gramatura sobe
// (papel mais grosso é mais barato por kg): desempatar pela maior gramatura
// escolhe sistematicamente o MENOR preço/kg, o oposto de proteger a margem.
// Exemplo: gramatura digitada 150; tabela tem 120g a R$12,50/kg e 180g a
// R$11,80/kg — empate de distância (|150-120|=30=|150-180|) — o critério
// antigo escolhia 180g e usava R$11,80 (mais barato); o correto é escolher a
// linha de MAIOR precoKg (120g, R$12,50) — a conservadora, que nunca
// subestima o custo do papel.
//
// Achado 6b — o fallback antes considerava TODAS as linhas da tabela,
// inclusive as com precoKg<=0 (gramatura cadastrada sem preço). Se essa
// linha "sem preço" fosse a gramatura mais próxima, ela vencia e devolvia um
// preço inválido, que derruba o orçamento em CUSTO_INVALIDO lá na frente —
// mesmo havendo outra linha com preço válido na mesma tabela. Agora essas
// linhas são descartadas da disputa quando existe pelo menos uma alternativa
// válida; só voltam a valer (e o erro segue acontecendo do jeito de sempre)
// quando NENHUMA linha da tabela tem preço válido.
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

  // Achado 6b — candidatas válidas são as com preço cadastrado; só recorre à
  // tabela inteira (aceitando precoKg<=0) se TODA linha estiver inválida,
  // caso em que não há nada melhor a fazer e o CUSTO_INVALIDO de sempre
  // acontece adiante.
  const candidatas = tabela.filter((linha) => linha.precoKg > 0);
  const pool = candidatas.length > 0 ? candidatas : tabela;

  const maisProxima = pool.reduce((melhor, atual) => {
    const distAtual = Math.abs(atual.gramatura - gramaturaDigitada);
    const distMelhor = Math.abs(melhor.gramatura - gramaturaDigitada);
    if (distAtual < distMelhor) return atual;
    // Achado 6a — empate de distância: fica com a linha mais CARA (maior
    // precoKg), não a de maior gramatura — ver exemplo no comentário da função.
    if (distAtual === distMelhor && atual.precoKg > melhor.precoKg) return atual;
    return melhor;
  });

  return { precoKg: maisProxima.precoKg, gramaturaBase: maisProxima.gramatura, origem: "APROXIMADO" };
}
