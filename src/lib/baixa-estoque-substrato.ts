import type { Prisma } from "@/generated/prisma/client";
import type { ModeloCalculo, UnidadeMedida } from "@/generated/prisma/enums";

// Achado N5 da auditoria de código (2026-09-04) — decide, PRA UMA LINHA de
// FichaTecnicaItem, se a baixa de estoque deve usar o consumo FÍSICO real que
// o motor avançado (OFFSET/M2/FLEXOGRAFIA) já calculou em
// OrcamentoItem.breakdown (imposição/nesting: folhas, área, metragem) em vez
// do consumo linear de sempre (quantidadePorUnidade × quantidade). Função
// pura, sem I/O — compartilhada entre os 3 lugares que replicam este cálculo
// (previsaoBaixaEstoque em src/app/producao/actions.ts, a tela de
// confirmação de "Iniciar impressão"; e os dois usos em
// src/app/producao/status-transicao.ts: a validação de estoque/perda ANTES
// da transação, e a baixa de verdade DENTRO dela) — os 3 precisam bater
// exatamente, senão a tela de confirmação mostra um número diferente do que
// é de fato descontado (ver comentário em buscarOrcamentoParaBaixa).
//
// Nunca aplicado à ficha técnica de ACABAMENTOS (SERVICO) — só a do PRODUTO:
// o breakdown vive em OrcamentoItem, que representa o produto vendido, não o
// serviço anexado como acabamento. A ficha técnica de acabamento (ex: BOPP
// consumido na laminação) continua 100% linear, sem nenhuma exceção — fora
// do escopo do achado N5, que é especificamente sobre o SUBSTRATO que o
// motor dimensiona pela imposição/nesting do PRODUTO.
//
// Decisão de design — como identificar QUAL linha da ficha técnica é o
// substrato (documentada também no comentário do campo
// FichaTecnicaItem.ehSubstratoPrincipal, prisma/schema/06-catalogo.prisma):
//
//   - OFFSET: o papel é uma FK FIXA no próprio produto (ItemGrafica.papelId,
//     configurada uma vez em Catálogo) — comparamos `ficha.materiaPrimaId`
//     contra ela. Identificação automática, sem precisar de nenhuma flag.
//   - M2 com ConfiguracaoClicheEtiqueta: o papel é escolhido POR ORÇAMENTO
//     (OrcamentoItemPrecificacaoEtiqueta.papelId) — comparamos
//     `ficha.materiaPrimaId` contra ELE. Também automático.
//   - FLEXOGRAFIA e M2 SEM clichê de etiqueta (ex: "Banner de Lona"): o motor
//     não referencia NENHUM ItemGrafica de matéria-prima separado — ele usa
//     o precoCompra/bobinas do PRÓPRIO produto (ver
//     carregarContextoPrecificacao em src/lib/pricing/carregar.ts:
//     `custoM2Material = Number(item.precoCompra ?? 0)` pro M2 sem etiqueta;
//     mesmo padrão pra FLEXOGRAFIA). Não existe FK nenhuma pra comparar aqui
//     — inferir automaticamente (ex: "a única linha da ficha técnica", ou "a
//     linha com nome parecido com o produto") seria adivinhação: um palpite
//     errado aplicaria o consumo do motor numa matéria-prima que NÃO é o
//     substrato real (ex: tinta), o que é PIOR que o bug original (que ao
//     menos consumia todas as linhas de forma consistente, mesmo que linear
//     demais). Por isso estes dois casos dependem inteiramente da flag
//     manual `FichaTecnicaItem.ehSubstratoPrincipal` — sem ela marcada,
//     comportamento idêntico a hoje (consumo linear), nunca um bloqueio ou
//     erro.
//
// A flag `ehSubstratoPrincipal` também funciona como reforço/override manual
// nos dois primeiros casos (ex: se por algum motivo o papelId automático não
// bater), mas isso é bônus — o caminho automático já cobre o caso comum sem
// exigir nenhuma ação do usuário.
//
// Conversão de unidade — NUNCA às cegas: só aplicamos a métrica do motor
// quando a UNIDADE DE ESTOQUE cadastrada na matéria-prima (ItemCatalogo.
// unidade) já é a unidade NATURAL que o motor produz pra aquele modelo:
//   - OFFSET: FOLHA (nº de folhas físicas, breakdown.metricas.folhasTotais)
//     ou KG (peso total do pedido, já calculado pelo motor em
//     breakdown.metricas.pesoTotalPedidoKg — nunca recalculado aqui a partir
//     de folhas × gramatura, pra não duplicar uma conversão que o motor já
//     fez e arriscar divergir dela).
//   - M2 (e DTF, achado A5 — mesmo calcularM2 compartilhado): METRO_QUADRADO
//     (breakdown.metricas.areaFaturavel).
//   - FLEXOGRAFIA: METRO_LINEAR (breakdown.metricas.metragemLinearM — metros
//     lineares da bobina ESCOLHIDA pelo motor; não multiplicamos pela largura
//     da bobina pra virar m², porque a unidade de estoque aqui é
//     especificamente "metro linear da bobina", não área).
// Qualquer outra unidade (ex: matéria-prima de papel controlada em PACOTE ou
// RESMA) não tem conversão suportada — cai no consumo linear de sempre. É
// uma limitação deliberada (documentada, não um bug): melhor manter o
// comportamento de hoje do que inventar um fator de conversão arriscado.
export type ItemParaResolucaoSubstrato = {
  modeloCalculo: ModeloCalculo;
  breakdown: Prisma.JsonValue | null;
  // ItemGrafica.papelId do PRODUTO (fixo no catálogo) — null quando o
  // produto não tem papel configurado ou o modelo não é OFFSET.
  papelIdProduto: string | null;
  // OrcamentoItemPrecificacaoEtiqueta.papelId (escolhido NESTE orçamento) —
  // null quando o item não usa o motor de clichê de etiqueta.
  papelIdOrcamentoEtiqueta: string | null;
};

export type FichaParaResolucaoSubstrato = {
  materiaPrimaId: string;
  ehSubstratoPrincipal: boolean;
  unidadeEstoque: UnidadeMedida | null;
};

// Retorna a quantidade FÍSICA (na unidade de estoque da matéria-prima) que
// deve substituir o consumo linear pra esta linha da ficha técnica — ou
// `null` quando esta linha não é o substrato identificado, OU é o substrato
// mas o breakdown não trouxe uma métrica utilizável nesta unidade. Em
// QUALQUER caso de `null`, o chamador deve cair pro consumo linear de sempre
// (quantidadePorUnidade × quantidade) — nunca lançar exceção, nunca zerar o
// consumo.
export function resolverQuantidadeSubstratoMotor(
  item: ItemParaResolucaoSubstrato,
  ficha: FichaParaResolucaoSubstrato
): number | null {
  if (!item.breakdown || typeof item.breakdown !== "object" || Array.isArray(item.breakdown)) {
    return null;
  }

  const ehSubstrato =
    ficha.ehSubstratoPrincipal ||
    (item.modeloCalculo === "OFFSET" &&
      item.papelIdProduto !== null &&
      ficha.materiaPrimaId === item.papelIdProduto) ||
    ((item.modeloCalculo === "M2" || item.modeloCalculo === "DTF") &&
      item.papelIdOrcamentoEtiqueta !== null &&
      ficha.materiaPrimaId === item.papelIdOrcamentoEtiqueta);

  if (!ehSubstrato) return null;

  const metricas = (item.breakdown as Record<string, unknown>).metricas;
  if (!metricas || typeof metricas !== "object") return null;
  const m = metricas as Record<string, unknown>;

  if (item.modeloCalculo === "OFFSET") {
    if (ficha.unidadeEstoque === "FOLHA") return lerNumeroNaoNegativo(m.folhasTotais);
    if (ficha.unidadeEstoque === "KG") return lerNumeroNaoNegativo(m.pesoTotalPedidoKg);
    return null;
  }
  // DTF (achado A5) reaproveita o MESMO calcularM2 do M2 — o breakdown tem a
  // mesma métrica areaFaturavel (área de filme consumida da bobina), então
  // recebe o mesmo tratamento aqui.
  if (item.modeloCalculo === "M2" || item.modeloCalculo === "DTF") {
    if (ficha.unidadeEstoque === "METRO_QUADRADO") return lerNumeroNaoNegativo(m.areaFaturavel);
    return null;
  }
  if (item.modeloCalculo === "FLEXOGRAFIA") {
    if (ficha.unidadeEstoque === "METRO_LINEAR") return lerNumeroNaoNegativo(m.metragemLinearM);
    return null;
  }
  return null;
}

function lerNumeroNaoNegativo(valor: unknown): number | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

// Wrapper de integração em cima de resolverQuantidadeSubstratoMotor — recebe
// o item/ficha "quase crus" (a forma que sai direto do include do Prisma em
// buscarOrcamentoParaBaixa) e já devolve a quantidade FINAL a usar na baixa
// (motor quando aplicável, linear como fallback) — os 3 call-sites (ver
// comentário no topo do arquivo) chamam exatamente esta função, nunca
// recalculam o "??" de fallback cada um por conta própria, pra não arriscar
// os 3 divergirem entre si com o tempo. Tipagem estrutural (não os tipos
// exatos gerados pelo Prisma) de propósito — os 3 call-sites têm resultados
// de query com formas ligeiramente diferentes (select vs include), mas todas
// compatíveis com este shape mínimo.
export function calcularQuantidadeConsumidaFichaProduto(
  item: {
    modeloCalculo: ModeloCalculo;
    breakdown: Prisma.JsonValue | null;
    quantidade: number;
    itemGrafica: { papelId: string | null };
    precificacaoEtiqueta: { papelId: string } | null;
  },
  ficha: {
    materiaPrimaId: string;
    ehSubstratoPrincipal: boolean;
    quantidadePorUnidade: Prisma.Decimal | number | string;
    materiaPrima: { itemCatalogo: { unidade: UnidadeMedida | null } };
  }
): number {
  const quantidadeLinear = Number(ficha.quantidadePorUnidade) * item.quantidade;
  const quantidadeMotor = resolverQuantidadeSubstratoMotor(
    {
      modeloCalculo: item.modeloCalculo,
      breakdown: item.breakdown,
      papelIdProduto: item.itemGrafica.papelId,
      papelIdOrcamentoEtiqueta: item.precificacaoEtiqueta?.papelId ?? null,
    },
    {
      materiaPrimaId: ficha.materiaPrimaId,
      ehSubstratoPrincipal: ficha.ehSubstratoPrincipal,
      unidadeEstoque: ficha.materiaPrima.itemCatalogo.unidade,
    }
  );
  return quantidadeMotor ?? quantidadeLinear;
}
