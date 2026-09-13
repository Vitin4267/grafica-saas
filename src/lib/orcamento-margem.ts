import type { Prisma } from "@/generated/prisma/client";

// Estima a margem de um item de orçamento ANTES de aprovar (alerta visual na
// tela de edição do RASCUNHO) — reaproveita EXATAMENTE a mesma regra de
// custo já usada em atualizarStatusOrcamento (cálculo de comissão) e em
// aplicarDescontoItemOrcamento (trava de preço mínimo), ver
// src/app/orcamento/[id]/actions.ts: motor avançado (M2/OFFSET) usa
// breakdown.custoTotal; item SIMPLES usa itemGrafica.precoCompra ×
// quantidade (preço de compra ATUAL do catálogo, não um snapshot do momento
// da venda). Nenhum cálculo de preço/custo novo é inventado aqui — só leitura
// e exibição do que o motor de precificação já gravou.

export type DadosItemParaMargem = {
  precoTotal: Prisma.Decimal | string | number;
  quantidade: number;
  breakdown: Prisma.JsonValue | null;
  precoCompra: Prisma.Decimal | string | number | null;
  // Achado N11 (bullet b) — quando o item é SIMPLES e o PRODUTO cobra por
  // área (ItemGrafica.simplesCobraPorArea), o preço já escalou por m², mas
  // "precoCompra × quantidade" sozinho ignorava a área — superestimava a
  // margem de um item como banner/lona vendido por m² (ex: margem calculada
  // em 95% quando a real era 70%). Todos opcionais/omitidos = comportamento
  // de sempre (× quantidade, sem área) — mesmo padrão de regressão zero dos
  // outros campos opcionais deste arquivo.
  larguraCm?: Prisma.Decimal | string | number | null;
  alturaCm?: Prisma.Decimal | string | number | null;
  simplesCobraPorArea?: boolean;
};

export type MargemItemOrcamento = {
  custoEstimado: number;
  precoTotal: number;
  margemPercent: number; // (precoTotal - custoEstimado) / precoTotal * 100
};

function lerCustoTotalBreakdown(breakdown: Prisma.JsonValue | null): number | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const valor = (breakdown as Record<string, unknown>).custoTotal;
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

// Achado D1 da auditoria do motor de preço (2026-09-13) — mesma leitura de
// lerCustoTotalBreakdown acima, mas de custoDireto (SEM overhead), não
// custoTotal (custoDireto × (1+overhead) — ver compor.ts). Existe só pra
// custoEstimadoParaAgregacao abaixo: a base "com overhead" de custoTotal é
// legítima pro medidor de margem de UM item motor avançado, mas item SIMPLES
// nunca tem overhead embutido no custo (preço digitado à mão, sem passar
// pelo motor) — somar os dois direto numa margem AGREGADA mistura duas
// bases diferentes de custo, produzindo um percentual que não descreve nem
// um item nem o outro (ver calcularMargemAgregadaOrcamento).
function lerCustoDiretoBreakdown(breakdown: Prisma.JsonValue | null): number | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const valor = (breakdown as Record<string, unknown>).custoDireto;
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

// Achado N12 — resolverPrecoPapel (src/lib/pricing/papel.ts) já calculava
// origem "EXATO"/"APROXIMADO" e a gramatura realmente usada pro R$/kg, mas
// carregarContextoPrecificacao descartava os dois (só lia precoKg). Agora
// chegam até breakdown.metricas (ver precificar.ts, branch OFFSET) — esta
// função só lê de volta pra a tela avisar o vendedor, mesmo espírito de
// lerCustoTotalBreakdown acima (nenhum cálculo novo, só leitura do que o
// motor já gravou). Retorna null sempre que não há aviso a mostrar (item
// não-OFFSET, sem breakdown, ou gramatura bateu exata).
export function lerAvisoGramaturaAproximada(
  breakdown: Prisma.JsonValue | null
): { gramaturaBasePapel: number } | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const metricas = (breakdown as Record<string, unknown>).metricas;
  if (!metricas || typeof metricas !== "object") return null;
  const { origemPrecoPapel, gramaturaBasePapel } = metricas as Record<string, unknown>;
  if (origemPrecoPapel !== "APROXIMADO") return null;
  const numero = Number(gramaturaBasePapel);
  if (!Number.isFinite(numero)) return null;
  return { gramaturaBasePapel: numero };
}

// Achado C2 da auditoria do motor de preço (2026-09-13) — mesma leitura de
// lerAvisoGramaturaAproximada acima, mas pro EDITORIAL: dois papéis
// independentes (miolo e capa), cada um podendo cair pro fallback de
// gramatura mais próxima por conta própria — por isso 2 pares de campos, não
// 1 (ver ContextoEditorial em tipos.ts e o branch EDITORIAL de
// precificar.ts). Sem isso, o achado C1 (gramatura fora da faixa) ficava
// completamente invisível na tela — nem o dedo-gordo clássico (digitar 9 em
// vez de 90) tinha como o vendedor perceber antes de fechar o orçamento.
export function lerAvisoGramaturaAproximadaEditorial(
  breakdown: Prisma.JsonValue | null
): { miolo: number | null; capa: number | null } | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const metricas = (breakdown as Record<string, unknown>).metricas;
  if (!metricas || typeof metricas !== "object") return null;
  const {
    origemPrecoPapelMiolo,
    gramaturaBaseMiolo,
    origemPrecoPapelCapa,
    gramaturaBaseCapa,
  } = metricas as Record<string, unknown>;

  const miolo =
    origemPrecoPapelMiolo === "APROXIMADO" && Number.isFinite(Number(gramaturaBaseMiolo))
      ? Number(gramaturaBaseMiolo)
      : null;
  const capa =
    origemPrecoPapelCapa === "APROXIMADO" && Number.isFinite(Number(gramaturaBaseCapa))
      ? Number(gramaturaBaseCapa)
      : null;

  if (miolo === null && capa === null) return null;
  return { miolo, capa };
}

// Área só entra quando o produto está marcado como "cobra por área" E as
// duas dimensões vieram preenchidas — mesma regra de calcularPreco em
// src/lib/orcamento.ts (nunca inventa área pra quem não pediu). Compartilhado
// por calcularMargemItemOrcamento e custoEstimadoParaAgregacao (achado D1) —
// só o leitor de breakdown (custoTotal vs custoDireto) muda entre os dois.
function resolverCustoEstimado(
  dados: DadosItemParaMargem,
  lerCustoDoBreakdown: (breakdown: Prisma.JsonValue | null) => number | null
): number | null {
  const custoDoBreakdown = lerCustoDoBreakdown(dados.breakdown);
  const larguraNumero = dados.larguraCm !== null && dados.larguraCm !== undefined ? Number(dados.larguraCm) : null;
  const alturaNumero = dados.alturaCm !== null && dados.alturaCm !== undefined ? Number(dados.alturaCm) : null;
  const areaM2 =
    dados.simplesCobraPorArea && larguraNumero && alturaNumero
      ? (larguraNumero / 100) * (alturaNumero / 100)
      : 1;
  const custoEstimado =
    custoDoBreakdown ??
    (dados.precoCompra !== null ? Number(dados.precoCompra) * dados.quantidade * areaM2 : null);
  return custoEstimado !== null && Number.isFinite(custoEstimado) ? custoEstimado : null;
}

// Retorna null quando o custo do item não pode ser estimado (sem
// breakdown.custoTotal do motor avançado E sem precoCompra cadastrado no
// catálogo) — nesse caso não mostra alerta nenhum pra esse item, em vez de
// fingir custo zero (mesmo princípio de "custo 0 mentiria" já usado nos
// outros pontos citados acima).
export function calcularMargemItemOrcamento(dados: DadosItemParaMargem): MargemItemOrcamento | null {
  const precoTotal = Number(dados.precoTotal);
  if (!Number.isFinite(precoTotal) || precoTotal <= 0) return null;

  const custoEstimado = resolverCustoEstimado(dados, lerCustoTotalBreakdown);
  if (custoEstimado === null) return null;

  return {
    custoEstimado,
    precoTotal,
    margemPercent: ((precoTotal - custoEstimado) / precoTotal) * 100,
  };
}

export type MargemAgregadaOrcamento =
  | { ok: true; margemPercent: number; custoEstimadoTotal: number; precoTotal: number }
  | { ok: false; itensSemCusto: number };

// Achado D1 da auditoria do motor de preço (2026-09-13) — calcularMargemItemOrcamento
// mede item motor avançado contra custoTotal (COM overhead) e item SIMPLES
// contra precoCompra×quantidade (SEM overhead, "defensável" isoladamente: um
// item SIMPLES tem preço digitado à mão, sem passar pelo motor). Isso é
// coerente PRA CADA ITEM, mas calcularMargemAgregadaOrcamento somava os dois
// custos numa mesma margemPercent — uma soma de bases diferentes que não
// descreve nem um item nem o outro (cenário da auditoria: 2 itens de custo
// real R$1.000/preço R$1.200 cada, um SIMPLES mede 16,7%, um M2 mede 4,2%,
// agregado sai ~10,4% — um número que não é a margem de ninguém). Pra
// AGREGAR de forma coerente, os dois lados precisam da MESMA base — aqui,
// custo DIRETO (sem overhead) dos dois, já que é a única base que os dois
// tipos de item têm em comum (overhead só existe pra quem passa pelo motor).
function custoEstimadoParaAgregacao(dados: DadosItemParaMargem): number | null {
  return resolverCustoEstimado(dados, lerCustoDiretoBreakdown);
}

// Soma a margem de TODOS os itens do orçamento — mas só devolve um número se
// TODO item com preço > 0 tiver custo conhecido. Se algum item não tiver
// (itensSemCusto > 0), a margem agregada some (ok:false) em vez de somar só
// o que dá pra calcular: um total parcial fingindo ser completo entenderia
// errado a margem real (mesmo princípio de custoPrevistoTotal===null em
// calcularPrevisaoAprovacaoPedido, src/lib/pedido-aprovacao.ts).
export function calcularMargemAgregadaOrcamento(itens: DadosItemParaMargem[]): MargemAgregadaOrcamento {
  let precoTotal = 0;
  let custoTotal = 0;
  let itensSemCusto = 0;

  for (const item of itens) {
    const precoItem = Number(item.precoTotal);
    if (!Number.isFinite(precoItem) || precoItem <= 0) continue; // item sem preço não entra na conta

    // Achado D1 — custo DIRETO (não calcularMargemItemOrcamento, que mede
    // contra custoTotal pro motor avançado), pra somar numa base coerente
    // entre item SIMPLES e item motor avançado (ver comentário acima).
    const custoEstimado = custoEstimadoParaAgregacao(item);
    if (custoEstimado === null) {
      itensSemCusto += 1;
      continue;
    }
    precoTotal += precoItem;
    custoTotal += custoEstimado;
  }

  if (itensSemCusto > 0 || precoTotal <= 0) {
    return { ok: false, itensSemCusto };
  }

  return {
    ok: true,
    margemPercent: ((precoTotal - custoTotal) / precoTotal) * 100,
    custoEstimadoTotal: custoTotal,
    precoTotal,
  };
}

// Limiares FIXOS desta tela — diferentes de ParametrosGrafica.margemFaixaBaixa/
// margemFaixaBoa (usados nos relatórios de saúde financeira do negócio, ver
// src/components/ui/MedidorMargem.tsx). Aqui o alerta é especificamente
// "está vendendo abaixo (ou perto) do custo direto", não uma meta de margem
// configurável por gráfica — por isso não reaproveita aquele parâmetro.
// LIMIAR_MARGEM_RUIM usa um epsilon (não 0 exato) porque MedidorMargem
// classifica com "margem < limiarRuim": um item vendido EXATAMENTE no preço
// de custo (margem = 0, lucro zero) também deve contar como "ruim".
export const LIMIAR_MARGEM_RUIM = 0.0001;
export const LIMIAR_MARGEM_ATENCAO = 15;
