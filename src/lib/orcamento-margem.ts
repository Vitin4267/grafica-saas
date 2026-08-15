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

// Retorna null quando o custo do item não pode ser estimado (sem
// breakdown.custoTotal do motor avançado E sem precoCompra cadastrado no
// catálogo) — nesse caso não mostra alerta nenhum pra esse item, em vez de
// fingir custo zero (mesmo princípio de "custo 0 mentiria" já usado nos
// outros pontos citados acima).
export function calcularMargemItemOrcamento(dados: DadosItemParaMargem): MargemItemOrcamento | null {
  const precoTotal = Number(dados.precoTotal);
  if (!Number.isFinite(precoTotal) || precoTotal <= 0) return null;

  const custoDoBreakdown = lerCustoTotalBreakdown(dados.breakdown);
  const custoEstimado =
    custoDoBreakdown ??
    (dados.precoCompra !== null ? Number(dados.precoCompra) * dados.quantidade : null);

  if (custoEstimado === null || !Number.isFinite(custoEstimado)) return null;

  return {
    custoEstimado,
    precoTotal,
    margemPercent: ((precoTotal - custoEstimado) / precoTotal) * 100,
  };
}

export type MargemAgregadaOrcamento =
  | { ok: true; margemPercent: number; custoEstimadoTotal: number; precoTotal: number }
  | { ok: false; itensSemCusto: number };

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

    const margem = calcularMargemItemOrcamento(item);
    if (margem === null) {
      itensSemCusto += 1;
      continue;
    }
    precoTotal += margem.precoTotal;
    custoTotal += margem.custoEstimado;
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
