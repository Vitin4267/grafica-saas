import "server-only";
import { prisma } from "@/lib/prisma";

// Achado F4 da auditoria de abrangência (Parte 7, 2026-09-05): "Também sem
// alerta de validade (mecânica já existe em alerta-estoque.ts, só falta o
// dado)". A mecânica de estoque baixo (verificarEDispararAlertaEstoque, ver
// src/lib/alerta-estoque.ts) dispara E-MAIL com dedup por
// ItemGrafica.alertaEstoqueEnviadoEm — estender ela pra validade exigiria um
// dedup por LOTE (não por item — o mesmo ItemGrafica pode ter vários lotes
// ao longo do tempo, cada um com sua própria validade), o que pediria mais
// um campo em MovimentacaoEstoque só pra dedup de e-mail. Decisão de design
// (autorizada pelo achado: "se a mecânica existente for difícil de
// estender com segurança, é aceitável fazer uma função nova e simples que
// só lê o dado"): este arquivo NÃO dispara e-mail — é uma função de
// LEITURA, no mesmo espírito de listarInsumosComPrecoDesatualizado
// (src/lib/custo-pedido.ts), consumida por um badge na tela de Catálogo
// (mesmo padrão visual de "Preço desatualizado" já usado lá). Roda sob
// demanda a cada carregamento de página, nunca cron — sem dedup persistido
// porque não há e-mail pra deduplicar: a badge simplesmente aparece
// enquanto a condição for verdadeira e some quando deixar de ser (self-
// healing por natureza, sem precisar de um campo *EnviadoEm).
//
// IMPORTANTE (mesmo princípio documentado no schema/status-transicao.ts):
// como este sistema não faz FEFO/apropriação automática de lote, "o lote
// em estoque" de um item é sempre o da ENTRADA_COMPRA mais recente (por
// item ou por variante) — nunca uma soma exata de saldo por lote.

// Pura, sem I/O — testável isoladamente. `agora` é parâmetro (não
// `Date.now()` direto) só pra o teste poder fixar uma data sem mockar o
// relógio do sistema inteiro.
export function loteEstaProximoOuVencido(validade: Date, agora: Date, diasLimiar: number): boolean {
  const limiar = agora.getTime() + diasLimiar * 86_400_000;
  return validade.getTime() <= limiar;
}

export type LoteProximoOuVencido = {
  itemGraficaId: string;
  varianteId: string | null;
  nome: string;
  lote: string;
  validade: Date;
  vencido: boolean;
};

// Acha, por gráfica, o lote mais recente de cada matéria-prima (e de cada
// variante dela) com controlaLote ativo — e retorna só os que estão
// vencidos ou vencendo dentro de ParametrosGrafica.diasAlertaValidadeEstoque
// (default 30). Só considera item/variante com estoque > 0 (lote de
// material que já zerou não precisa de aviso — não há mais risco de usar
// num pedido). Sem variável de ambiente nem cron: chamada direto de
// /catalogo (ver page.tsx), mesmo padrão on-demand de
// verificarEDispararAlertaEstoque.
export async function listarLotesProximosOuVencidos(graficaId: string): Promise<LoteProximoOuVencido[]> {
  const parametros = await prisma.parametrosGrafica.findUnique({
    where: { graficaId },
    select: { diasAlertaValidadeEstoque: true },
  });
  const diasLimiar = parametros?.diasAlertaValidadeEstoque ?? 30;
  const agora = new Date();

  const itens = await prisma.itemGrafica.findMany({
    where: {
      graficaId,
      ativo: true,
      controlaLote: true,
      itemCatalogo: { tipo: "MATERIA_PRIMA" },
    },
    select: {
      id: true,
      estoqueAtual: true,
      itemCatalogo: { select: { nome: true } },
      variantes: { where: { ativo: true }, select: { id: true, rotulo: true, estoqueAtual: true } },
      // Todas as entradas com lote, mais recente primeiro — agrupamos por
      // varianteId em memória abaixo (a primeira ocorrência de cada chave,
      // nesta ordem, já é a mais recente daquele item/variante).
      movimentacoes: {
        where: { tipo: "ENTRADA_COMPRA", lote: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { varianteId: true, lote: true, validade: true },
      },
    },
  });

  const resultado: LoteProximoOuVencido[] = [];

  for (const item of itens) {
    // Chave null = o próprio ItemGrafica (sem variante); chave = varianteId
    // pras entradas daquela variante especificamente.
    const ultimaPorChave = new Map<string | null, { lote: string; validade: Date | null }>();
    for (const mov of item.movimentacoes) {
      if (!ultimaPorChave.has(mov.varianteId)) {
        ultimaPorChave.set(mov.varianteId, { lote: mov.lote!, validade: mov.validade });
      }
    }

    const semVariante = ultimaPorChave.get(null);
    if (
      semVariante?.validade &&
      item.estoqueAtual !== null &&
      Number(item.estoqueAtual) > 0 &&
      loteEstaProximoOuVencido(semVariante.validade, agora, diasLimiar)
    ) {
      resultado.push({
        itemGraficaId: item.id,
        varianteId: null,
        nome: item.itemCatalogo.nome,
        lote: semVariante.lote,
        validade: semVariante.validade,
        vencido: semVariante.validade.getTime() < agora.getTime(),
      });
    }

    for (const variante of item.variantes) {
      const doVariante = ultimaPorChave.get(variante.id);
      if (
        doVariante?.validade &&
        variante.estoqueAtual !== null &&
        Number(variante.estoqueAtual) > 0 &&
        loteEstaProximoOuVencido(doVariante.validade, agora, diasLimiar)
      ) {
        resultado.push({
          itemGraficaId: item.id,
          varianteId: variante.id,
          nome: `${item.itemCatalogo.nome} — ${variante.rotulo}`,
          lote: doVariante.lote,
          validade: doVariante.validade,
          vencido: doVariante.validade.getTime() < agora.getTime(),
        });
      }
    }
  }

  return resultado;
}
