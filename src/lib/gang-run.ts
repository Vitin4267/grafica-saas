// Lógica PURA do gang run (imposição combinada) — sem Prisma, 100%
// testável. Fila de candidatos + agrupamento + rateio de custo moram aqui;
// tudo que toca banco fica em src/lib/gang-run-servico.ts (mesma separação
// já usada no motor de precificação: src/lib/pricing/*.ts puro vs.
// src/lib/pricing/carregar.ts com Prisma).
//
// Contexto de negócio (ver spec do MVP): "gang run" é combinar peças de
// PEDIDOS DIFERENTES numa mesma chapa/folha Offset pra dividir o custo fixo
// de setup (chapa + acerto de máquina) entre eles — o motor de nesting já
// existente (src/lib/pricing/offset.ts) só combina peças DENTRO do mesmo
// pedido; isto aqui é a camada que decide QUANDO um item é pequeno demais
// pra rodar sozinho e QUANTO cada pedido paga quando um grupo é combinado.
import { D, paraDecimal, type Dec } from "@/lib/pricing/decimal";

// ---------------------------------------------------------------------------
// Candidatura: um item entra na fila quando sozinho não preenche uma folha.
// ---------------------------------------------------------------------------

// MVP: só o caso mais simples e mais comum (a peça nem enche UMA folha
// sozinha, ex: 250 cartões de visita numa folha que cabe 1.000) vira
// candidato. Deliberadamente fora de escopo: pedidos que precisam de várias
// folhas mas deixam a ÚLTIMA parcialmente cheia (ex: 2.300 peças numa folha
// de 1.000-up, sobram 300 na 3ª folha) — também são um caso real de gang
// run, mas exigiriam decidir QUAL folha entre várias tem a sobra, o que já
// esbarra no problema de bin-packing que o motor de nesting atual não
// resolve. Ver seção "fora do MVP" no resumo da feature.
export function ehCandidatoGangRun(quantidade: number, nUpPeca: number): boolean {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return false;
  if (!Number.isFinite(nUpPeca) || nUpPeca <= 0) return false;
  return quantidade < nUpPeca;
}

// Quanto da capacidade de UMA folha este item sozinho ocupa — 0.6 = 60% de
// uma folha. Usado tanto pra decidir candidatura (< 1) quanto pra mostrar
// "quanto o grupo já preenche" e pra ratear o custo de setup.
export function calcularFracaoFolha(quantidade: number, nUpPeca: number): Dec {
  return paraDecimal(quantidade).div(nUpPeca);
}

// ---------------------------------------------------------------------------
// Agrupamento: só itens com a MESMA chave física podem compartilhar chapa.
// ---------------------------------------------------------------------------

export type ChaveGrupoGangRunInput = {
  papelId: string;
  gramaturaGm2: number;
  prensaId: string;
  folhaId: string;
  corFrente: number;
  corVerso: number;
};

// Papel + gramatura + prensa + folha (formato físico que o motor de nesting
// ESCOLHEU pra este item) + cores — os seis eixos que precisam bater pra
// duas peças poderem sair na mesma chapa impressa. corFrente/corVerso entram
// na chave porque as torres de tinta da prensa são montadas pro jogo de
// cores da rodada inteira: misturar um item 4x0 com um 1x0 na mesma chapa
// obrigaria a prensa a rodar como 4x0 pros dois, o que já deixou de ser uma
// divisão "justa" de custo — fora do MVP (ver resumo da feature).
export function chaveGrupoGangRun(item: ChaveGrupoGangRunInput): string {
  return [
    item.papelId,
    item.gramaturaGm2,
    item.prensaId,
    item.folhaId,
    item.corFrente,
    item.corVerso,
  ].join("::");
}

export function agruparPorChave<T>(itens: T[], chave: (item: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    const lista = grupos.get(k);
    if (lista) {
      lista.push(item);
    } else {
      grupos.set(k, [item]);
    }
  }
  return grupos;
}

// ---------------------------------------------------------------------------
// Rateio: custo fixo de chapa+acerto dividido proporcionalmente ao espaço.
// ---------------------------------------------------------------------------

export type ItemParaRateio = { id: string; fracaoFolha: Dec | number | string };

// Divide custoTotal (chapa + acerto de UMA rodada compartilhada — valor
// fixo, não escala com quantidade, ver comentário em offset.ts sobre
// custoChapas/custoSetup) proporcionalmente à fracaoFolha de cada item.
// Arredonda cada fatia pra 2 casas e ajusta a ÚLTIMA (maior fração primeiro,
// current key order sujeita a determinismo — ver ordenação abaixo) pra
// absorver a sobra de centavos do arredondamento, garantindo que a soma das
// fatias bate exatamente com custoTotal (nunca "perde" nem "inventa"
// centavo). Item com fracaoFolha<=0 (não deveria acontecer — candidatura já
// exige fracaoFolha>0) fica de fora do rateio.
export function ratearCustoSetup(itens: ItemParaRateio[], custoTotal: Dec): Map<string, Dec> {
  const resultado = new Map<string, Dec>();
  const validos = itens
    .map((item) => ({ id: item.id, fracao: paraDecimal(item.fracaoFolha) }))
    .filter((item) => item.fracao.gt(0));

  if (validos.length === 0 || custoTotal.lte(0)) {
    for (const item of itens) resultado.set(item.id, paraDecimal(0));
    return resultado;
  }

  const somaFracoes = validos.reduce((soma, item) => soma.plus(item.fracao), paraDecimal(0));

  // Ordenação determinística (maior fração primeiro) só pra decidir de
  // forma estável QUAL item absorve o resto do arredondamento — não muda o
  // valor de ninguém além do último da lista.
  const ordenados = [...validos].sort((a, b) => b.fracao.minus(a.fracao).toNumber());

  let somaRateada = paraDecimal(0);
  ordenados.forEach((item, indice) => {
    const ehUltimo = indice === ordenados.length - 1;
    const fatia = ehUltimo
      ? custoTotal.minus(somaRateada)
      : custoTotal.times(item.fracao).div(somaFracoes).toDecimalPlaces(2, D.ROUND_HALF_UP);
    somaRateada = somaRateada.plus(fatia);
    resultado.set(item.id, fatia);
  });

  for (const item of itens) {
    if (!resultado.has(item.id)) resultado.set(item.id, paraDecimal(0));
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Leitura do breakdown salvo em OrcamentoItem.breakdown (motor Offset).
// ---------------------------------------------------------------------------

export type DadosOffsetDoBreakdown = {
  nUp: number;
  folhaId: string;
  folhaNome: string;
  custoChapas: Dec;
  custoSetup: Dec;
};

// Extrai só o que o gang run precisa do breakdown que precificar() já grava
// em OrcamentoItem.breakdown pra item OFFSET (ver src/lib/orcamento-
// precificacao.ts) — mesmo formato que componentesCustoBreakdown já lê em
// src/lib/pedido-aprovacao.ts: `detalhes` serializa Decimal como STRING,
// `metricas` como number puro. Retorna null pra qualquer formato inesperado
// (breakdown ausente, item pré-existente sem esse shape) — defensivo, nunca
// inventa um valor.
export function lerDadosOffsetDoBreakdown(breakdown: unknown): DadosOffsetDoBreakdown | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const raiz = breakdown as Record<string, unknown>;

  const detalhesRaw = raiz.detalhes;
  const metricasRaw = raiz.metricas;
  if (!detalhesRaw || typeof detalhesRaw !== "object") return null;
  if (!metricasRaw || typeof metricasRaw !== "object") return null;
  const detalhes = detalhesRaw as Record<string, unknown>;
  const metricas = metricasRaw as Record<string, unknown>;

  const nUp = metricas.nUp;
  if (typeof nUp !== "number" || !Number.isFinite(nUp) || nUp <= 0) return null;

  const folhaEscolhidaRaw = metricas.folhaEscolhida;
  if (!folhaEscolhidaRaw || typeof folhaEscolhidaRaw !== "object") return null;
  const folhaEscolhida = folhaEscolhidaRaw as Record<string, unknown>;
  if (typeof folhaEscolhida.id !== "string") return null;

  const chapasRaw = detalhes.chapas;
  const setupRaw = detalhes.setup;
  if (typeof chapasRaw !== "string" && typeof chapasRaw !== "number") return null;
  if (typeof setupRaw !== "string" && typeof setupRaw !== "number") return null;

  let custoChapas: Dec;
  let custoSetup: Dec;
  try {
    custoChapas = new D(chapasRaw);
    custoSetup = new D(setupRaw);
  } catch {
    return null;
  }
  if (!custoChapas.isFinite() || !custoSetup.isFinite()) return null;

  return {
    nUp,
    folhaId: folhaEscolhida.id,
    folhaNome: typeof folhaEscolhida.nome === "string" ? folhaEscolhida.nome : "",
    custoChapas,
    custoSetup,
  };
}
