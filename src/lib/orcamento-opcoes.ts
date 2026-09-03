import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { aplicarPisoDoPedido } from "@/lib/pricing";
import { paraDecimal } from "@/lib/pricing/decimal";

// Múltiplas opções de proposta no mesmo orçamento/link público (ver model
// OrcamentoOpcao no schema.prisma pro desenho completo). MVP: no máximo esta
// quantidade de alternativas além da opção-base ("Opção A", que nunca tem
// linha em OrcamentoOpcao — continua vivendo em Orcamento.itens/total de
// sempre) — 3 opções no total contando a base.
export const MAX_OPCOES_ALTERNATIVAS = 2;

export type ResolucaoOpcoes = {
  // Novo Orcamento.total — sempre a soma dos itens que sobraram com
  // opcaoId=null depois da resolução (a opção vencedora, promovida).
  total: string;
  // Novo Orcamento.opcaoEscolhidaNome — snapshot do nome da opção vencedora,
  // só preenchido quando o orçamento chegou a ter opções alternativas.
  opcaoEscolhidaNome: string | null;
};

// Chamado de DENTRO da transação de aprovação (autenticada em
// src/app/orcamento/[id]/actions.ts OU pública em src/app/o/[token]/actions.ts
// — as duas chamam esta mesma função, pra nunca divergir), DEPOIS do CAS de
// status já ter tido sucesso. Resolve o "torneio" entre a opção-base e
// qualquer OrcamentoOpcao alternativa cadastrada:
//
// - Sem nenhuma OrcamentoOpcao (caso de sempre, inclusive todo orçamento
//   aprovado antes desta feature): não mexe em nada, só devolve o total já
//   gravado em Orcamento.total (mantido incrementalmente por
//   editarOrcamento/adicionarItemOrcamento/removerItemOrcamento/
//   aplicarDescontoItemOrcamento, todos escopados a opcaoId=null).
// - opcaoEscolhidaId === null (a opção-base venceu entre alternativas):
//   descarta TODAS as alternativas (cascade apaga os itens delas) — a base
//   nunca é tocada.
// - opcaoEscolhidaId != null (uma alternativa venceu): descarta a base
//   perdedora por completo, promove os itens da vencedora pra opcaoId=null
//   (viram a nova base) e só então apaga todas as linhas de OrcamentoOpcao —
//   a vencedora já está vazia (seus itens saíram no passo anterior) e
//   qualquer outra alternativa perdedora cascade-apaga os itens que ainda
//   apontam pra ela.
//
// Depois desta função, o orçamento aprovado é indistinguível de um orçamento
// de opção única de sempre: Pedido, Comissao, PDF, relatórios e ficha técnica
// nunca precisam saber que opções existiram.
export async function resolverOpcoesNaAprovacao(
  tx: Prisma.TransactionClient,
  params: { orcamentoId: string; opcaoEscolhidaId: string | null }
): Promise<ResolucaoOpcoes> {
  const opcoes = await tx.orcamentoOpcao.findMany({
    where: { orcamentoId: params.orcamentoId },
    select: { id: true, nome: true, total: true },
  });

  if (opcoes.length === 0) {
    const orcamento = await tx.orcamento.findUniqueOrThrow({
      where: { id: params.orcamentoId },
      select: { total: true },
    });
    return { total: orcamento.total.toString(), opcaoEscolhidaNome: null };
  }

  if (params.opcaoEscolhidaId === null) {
    await tx.orcamentoOpcao.deleteMany({ where: { orcamentoId: params.orcamentoId } });
    const [agregado, orcamento] = await Promise.all([
      tx.orcamentoItem.aggregate({
        where: { orcamentoId: params.orcamentoId, opcaoId: null },
        _sum: { precoTotal: true },
      }),
      tx.orcamento.findUniqueOrThrow({
        where: { id: params.orcamentoId },
        select: { graficaId: true },
      }),
    ]);
    // Achado N3 — esta função reagrega os itens da base DO ZERO (em vez de
    // confiar em Orcamento.total já gravado) em vez de assumir que ele
    // reflete os itens atuais — mas um sum() cru de OrcamentoItem.precoTotal
    // não carrega o piso de pedido. Reaplica aqui, mesma regra de
    // recalcularTotalOrcamento (src/lib/orcamento-precificacao.ts) — sem
    // isso, um orçamento cuja base ficou abaixo do mínimo perderia o piso
    // ao "vencer o torneio" contra uma opção alternativa.
    const parametros = await tx.parametrosGrafica.findUnique({
      where: { graficaId: orcamento.graficaId },
      select: { pedidoMinimo: true, incrementoArredondamento: true },
    });
    const total = aplicarPisoDoPedido(
      paraDecimal((agregado._sum.precoTotal ?? 0).toString()),
      paraDecimal(parametros?.pedidoMinimo.toString() ?? "0"),
      paraDecimal(parametros?.incrementoArredondamento.toString() ?? "0.10")
    );
    return { total: total.toFixed(2), opcaoEscolhidaNome: "Opção A" };
  }

  const vencedora = opcoes.find((o) => o.id === params.opcaoEscolhidaId);
  if (!vencedora) {
    // Defensivo — quem chama já valida a existência da opção antes de entrar
    // na transação; só chegaria aqui numa corrida em que a opção foi
    // removida entre a validação e o CAS (ver removerOpcaoOrcamento, que só
    // roda em RASCUNHO — o orçamento já teria que ter saído de ENVIADO e
    // voltado, cenário que a checagem de transição de status já barra em
    // condições normais). Aborta a transação inteira com uma mensagem clara
    // em vez de silenciosamente promover a opção errada.
    throw new Error("Opção escolhida não encontrada neste orçamento.");
  }

  await tx.orcamentoItem.deleteMany({ where: { orcamentoId: params.orcamentoId, opcaoId: null } });
  await tx.orcamentoItem.updateMany({
    where: { opcaoId: vencedora.id },
    data: { opcaoId: null },
  });
  await tx.orcamentoOpcao.deleteMany({ where: { orcamentoId: params.orcamentoId } });

  return { total: vencedora.total.toString(), opcaoEscolhidaNome: vencedora.nome };
}

// Chamado de DENTRO da transação de rejeição — nenhuma opção foi escolhida,
// mas o invariante "orçamento em status terminal nunca tem linha em
// OrcamentoOpcao" (ver comentário do model no schema.prisma) ainda precisa
// valer. Cascade apaga os itens das alternativas; a base (Opção A) nunca é
// tocada. Sem custo perceptível quando o orçamento nunca teve opção nenhuma
// (deleteMany com zero linhas casando).
export async function descartarOpcoesAlternativas(
  tx: Prisma.TransactionClient,
  orcamentoId: string
): Promise<void> {
  await tx.orcamentoOpcao.deleteMany({ where: { orcamentoId } });
}
