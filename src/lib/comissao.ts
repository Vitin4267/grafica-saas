// Cálculo puro (sem Prisma) — testável isoladamente. A extração do custo
// real por item (breakdown do motor avançado vs. precoCompra do SIMPLES)
// fica no chamador (src/app/orcamento/[id]/actions.ts), que tem acesso ao
// banco; aqui só decide o valor-base e a comissão a partir de números já
// prontos.
export type BaseComissao = "VALOR" | "LUCRO";

// Math.max(0, custoTotal) é defesa em profundidade: um custo NEGATIVO faria
// `precoTotal - custoTotal` SOMAR ao valor-base, inflando a comissão do
// vendedor em vez de reduzi-la. A origem desse custo negativo (precoCompra
// negativo aceito em salvarCatalogo) foi fechada na auditoria de 2026-07-26,
// mas o cálculo não deve depender disso — um custo negativo não tem
// significado físico e nunca deve virar lucro.
export function calcularValorBase(
  total: number,
  itens: { precoTotal: number; custoTotal: number }[],
  baseCalculo: BaseComissao
): number {
  if (baseCalculo === "VALOR") return total;
  return itens.reduce(
    (soma, item) => soma + (item.precoTotal - Math.max(0, item.custoTotal)),
    0
  );
}

// Math.max(0, ...) — um orçamento vendido abaixo do custo (desconto grande,
// erro de precificação) nunca vira comissão negativa descontada de outra
// coisa; nesse caso o vendedor simplesmente não recebe por aquele orçamento.
export function calcularComissao(valorBase: number, percentual: number): number {
  return Math.max(0, valorBase) * percentual;
}

// Achado A12 da Parte 4 da auditoria de abrangência (2026-09-09) — resolução
// por especificidade de RegraComissao, mesmo espírito de
// resolverLimiteDesconto/resolverLimiteAprovacaoCompra
// (src/lib/alcada-aprovacao.ts: usuário específico > papel > fallback
// global), mas com 5 dimensões em vez de 2, então especificidade é uma
// CONTAGEM de filtros preenchidos em vez de duas checagens em cascata.
//
// Formato mínimo de uma linha de RegraComissao pra esta função — o call site
// real busca as regras ATIVAS da gráfica (findMany filtrado por
// graficaId+ativa=true) e passa aqui; esta função não toca banco (pura,
// testável isolada).
export type RegraComissaoCandidata = {
  id: string;
  prioridade: number;
  usuarioId: string | null;
  itemCatalogoId: string | null;
  tipoItem: string | null;
  margemMinPercent: number | null;
  margemMaxPercent: number | null;
  percentual: number;
  baseCalculo: BaseComissao | null;
};

// A "venda" que está sendo resolvida — usuarioId null representa vendedor
// SEM cadastro (Orcamento.vendedor só texto livre, ver Comissao.
// representanteNome): só regras com usuarioId=null (vale pra "qualquer
// vendedor") podem bater nesse caso, já que não há Usuario nenhum pra
// comparar. itemCatalogoId/tipoItem/margemPercent ficam undefined quando o
// orçamento mistura itens de mais de um produto/categoria/margem — nesse
// caso só regras SEM filtro nessa dimensão específica podem bater (mesma
// regra de "null = vale pra qualquer um" já vale pra uma dimensão
// indeterminada).
export type ContextoResolucaoComissao = {
  usuarioId: string | null;
  itemCatalogoId?: string | null;
  tipoItem?: string | null;
  margemPercent?: number | null;
};

function regraBateComContexto(
  regra: RegraComissaoCandidata,
  contexto: ContextoResolucaoComissao
): boolean {
  if (regra.usuarioId !== null && regra.usuarioId !== contexto.usuarioId) return false;
  if (
    regra.itemCatalogoId !== null &&
    regra.itemCatalogoId !== (contexto.itemCatalogoId ?? null)
  )
    return false;
  if (regra.tipoItem !== null && regra.tipoItem !== (contexto.tipoItem ?? null)) return false;
  if (regra.margemMinPercent !== null || regra.margemMaxPercent !== null) {
    const margem = contexto.margemPercent ?? null;
    if (margem === null) return false; // regra filtra por margem, mas não sabemos a margem — não bate
    if (regra.margemMinPercent !== null && margem < regra.margemMinPercent) return false;
    if (regra.margemMaxPercent !== null && margem > regra.margemMaxPercent) return false;
  }
  return true;
}

// Quantos filtros esta regra tem preenchidos — "mais campos preenchidos =
// mais específica", literal.
function especificidadeRegra(regra: RegraComissaoCandidata): number {
  let n = 0;
  if (regra.usuarioId !== null) n++;
  if (regra.itemCatalogoId !== null) n++;
  if (regra.tipoItem !== null) n++;
  if (regra.margemMinPercent !== null) n++;
  if (regra.margemMaxPercent !== null) n++;
  return n;
}

// Resolve qual RegraComissao (entre as candidatas, já filtradas por
// graficaId+ativa=true pelo call site) se aplica a uma venda específica.
// Prioridade: regra mais ESPECÍFICA que bater com o contexto (mais filtros
// preenchidos) vence; empate entre regras igualmente específicas é
// quebrado por `prioridade` (maior primeiro), e empate total (mesma
// especificidade E mesma prioridade) é resolvido pela ORDEM de chegada
// (determinístico, não aleatório) — caso de borda que a UI deveria evitar
// deixando o usuário configurar prioridades diferentes.
//
// null = nenhuma regra bateu — o CALL SITE cai no fallback de sempre
// (Usuario.comissaoPercent + ParametrosGrafica.comissaoVendedorBase), nunca
// aqui dentro (esta função não conhece esse fallback, mantém a pureza).
export function resolverRegraComissao(
  regras: RegraComissaoCandidata[],
  contexto: ContextoResolucaoComissao
): RegraComissaoCandidata | null {
  const candidatas = regras.filter((regra) => regraBateComContexto(regra, contexto));
  if (candidatas.length === 0) return null;

  let melhor = candidatas[0];
  let melhorEspecificidade = especificidadeRegra(melhor);
  for (let i = 1; i < candidatas.length; i++) {
    const atual = candidatas[i];
    const especificidadeAtual = especificidadeRegra(atual);
    if (
      especificidadeAtual > melhorEspecificidade ||
      (especificidadeAtual === melhorEspecificidade && atual.prioridade > melhor.prioridade)
    ) {
      melhor = atual;
      melhorEspecificidade = especificidadeAtual;
    }
  }
  return melhor;
}
