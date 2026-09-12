import "server-only";

import { prisma } from "@/lib/prisma";
import { D, type Dec } from "@/lib/pricing/decimal";
import { calcularCoberturaOverhead, type ResultadoCoberturaOverhead } from "@/lib/cobertura-overhead";

/**
 * Camada de consulta da cobertura de overhead (achado A2 da Parte 4 da
 * auditoria de abrangência) — busca os agregados no Postgres e entrega pro
 * motor puro (src/lib/cobertura-overhead.ts) montar o resultado. Mesma
 * separação de dre-query.ts/dre.ts: NENHUMA regra de negócio mora aqui, só
 * busca e soma.
 *
 * FORA DE ESCOPO (deliberado, ver comentário em cobertura-overhead.ts):
 * nada aqui lê ou grava `ParametrosGrafica.overheadModo` nem toca o motor de
 * preço — isto é só leitura pra relatório.
 *
 * @param graficaId tenant
 * @param inicio início do período (inclusive) — instante real (Brasília),
 *   já resolvido pelo chamador (ver limitesMesBrasilia em src/lib/data.ts).
 * @param fim fim do período (exclusive).
 */
export async function buscarCoberturaOverhead(
  graficaId: string,
  inicio: Date,
  fim: Date
): Promise<ResultadoCoberturaOverhead> {
  const semPedidoCancelado = { NOT: { pedido: { status: "CANCELADO" as const } } };

  const [orcamentosAprovados, custoFixoAgregado] = await Promise.all([
    // Breakdown dos itens de orçamentos APROVADOS no período, pra somar o
    // overhead cobrado (detalhes.overhead) e o custo direto agregado
    // (custoDireto, achado N20 — ver comentário completo em
    // cobertura-overhead.ts), ambos gravados por src/lib/pricing/compor.ts e
    // serializados em src/lib/orcamento-precificacao.ts. Orcamento.total NÃO
    // é mais buscado aqui — era usado como base do "percentual que
    // fecharia" (achado N20: base errada, corrigida pra custoDireto).
    prisma.orcamento.findMany({
      where: {
        graficaId,
        status: "APROVADO",
        createdAt: { gte: inicio, lt: fim },
        ...semPedidoCancelado,
      },
      select: {
        itens: { select: { breakdown: true } },
      },
    }),
    // Custo fixo pago no período — MESMA where clause de dre-query.ts
    // (Despesa PAGA cuja CategoriaCusto.natureza = FIXO). Replicada aqui em
    // vez de derivada de ResultadoDRE porque o DRE só expõe a linha já
    // negativada/formatada, não o agregado bruto.
    prisma.despesa.aggregate({
      where: {
        graficaId,
        status: "PAGA",
        pagoEm: { gte: inicio, lt: fim },
        categoriaCusto: { natureza: "FIXO" },
      },
      _sum: { valor: true },
    }),
  ]);

  let overheadCobradoDec = new D(0);
  let custoDiretoAgregadoDec = new D(0);
  for (const orcamento of orcamentosAprovados) {
    for (const item of orcamento.itens) {
      overheadCobradoDec = overheadCobradoDec.plus(extrairOverheadDoBreakdown(item.breakdown));
      custoDiretoAgregadoDec = custoDiretoAgregadoDec.plus(extrairCustoDiretoDoBreakdown(item.breakdown));
    }
  }

  const custoFixoPagoDec = new D(String(custoFixoAgregado._sum.valor ?? 0));

  return calcularCoberturaOverhead({
    overheadCobrado: overheadCobradoDec.toNumber(),
    custoFixoPago: custoFixoPagoDec.toNumber(),
    custoDiretoAgregado: custoDiretoAgregadoDec.toNumber(),
  });
}

/**
 * `OrcamentoItem.breakdown` é o `ResultadoPrecificacao` (src/lib/pricing/
 * precificar.ts) serializado via `JSON.parse(JSON.stringify(...))` — Decimal
 * vira string. Shape esperado: `{ detalhes: { overhead: "123.45", ... } }`.
 * Item sem breakdown (nunca precificado) ou com shape inesperado conta 0 —
 * nunca lança, é só relatório.
 */
function extrairOverheadDoBreakdown(breakdown: unknown): Dec {
  if (
    breakdown !== null &&
    typeof breakdown === "object" &&
    "detalhes" in breakdown &&
    breakdown.detalhes !== null &&
    typeof breakdown.detalhes === "object" &&
    "overhead" in breakdown.detalhes
  ) {
    const overhead = (breakdown.detalhes as { overhead: unknown }).overhead;
    if (typeof overhead === "string" || typeof overhead === "number") {
      return new D(String(overhead));
    }
  }
  return new D(0);
}

/**
 * Achado N20 — `custoDireto` é campo de TOPO de `ResultadoComposicao`
 * (src/lib/pricing/compor.ts), irmão de `detalhes` (não aninhado dentro
 * dele, diferente de `overhead` acima) — mesmo nível de `custoTotal`, que já
 * é lido assim em outros lugares do repo (ex: src/app/orcamento/[id]/
 * actions/itens.ts). Item SIMPLES nunca passa por `comporPreco` (não tem
 * `custoDireto` nenhum) e conta 0 aqui — mesma limitação já documentada no
 * achado N30 da Parte 9, não corrigida nesta rodada.
 */
function extrairCustoDiretoDoBreakdown(breakdown: unknown): Dec {
  if (breakdown !== null && typeof breakdown === "object" && "custoDireto" in breakdown) {
    const custoDireto = (breakdown as { custoDireto: unknown }).custoDireto;
    if (typeof custoDireto === "string" || typeof custoDireto === "number") {
      return new D(String(custoDireto));
    }
  }
  return new D(0);
}
