"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";

// Achado F3 da auditoria de abrangência (2026-09-14), escopo reduzido — mesma
// estrutura RBAC/tenant de parada-actions.ts/actions.ts (PRODUCAO.podeEditar,
// graficaId isolado). Marcador ADITIVO e PARALELO, nunca mexe em
// Pedido.status: ver comentário completo no model ItemPedidoStatus
// (prisma/schema/10-producao.prisma).

export type AlternarItemConcluidoResult = { ok: boolean; mensagem: string };

// Toggle idempotente: lê o estado ALVO direto do checkbox (name="concluido",
// "on"/ausente — semântica nativa de <input type="checkbox">), não infere a
// partir do que já existe no banco. Marcar cria a linha (upsert evita erro
// de unique se 2 cliques concorrerem); desmarcar apaga (deleteMany, nunca
// falha se a linha já não existir — mesmo cuidado de idempotência do resto
// do projeto).
export async function alternarItemPedidoConcluido(
  _estadoAnterior: AlternarItemConcluidoResult | null,
  formData: FormData
): Promise<AlternarItemConcluidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const pedidoId = String(formData.get("pedidoId") ?? "");
  const orcamentoItemId = String(formData.get("orcamentoItemId") ?? "");
  const concluido = formData.get("concluido") === "on";

  // findFirst (não findUnique) porque a checagem real é "este item pertence
  // a um pedido DESTA gráfica" — nunca confia no id cru do formulário,
  // mesmo cuidado de isolamento de tenant do resto do projeto.
  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    select: {
      id: true,
      orcamento: { select: { itens: { where: { id: orcamentoItemId }, select: { id: true } } } },
    },
  });
  if (!pedido || pedido.orcamento.itens.length === 0) {
    return { ok: false, mensagem: "Item não encontrado neste pedido." };
  }

  if (concluido) {
    await prisma.itemPedidoStatus.upsert({
      where: { pedidoId_orcamentoItemId: { pedidoId, orcamentoItemId } },
      update: {},
      create: {
        graficaId: usuario.graficaId,
        pedidoId,
        orcamentoItemId,
        concluidoPorId: usuario.id,
      },
    });
  } else {
    await prisma.itemPedidoStatus.deleteMany({ where: { pedidoId, orcamentoItemId } });
  }

  revalidatePath("/producao");
  return { ok: true, mensagem: concluido ? "Item marcado como concluído." : "Marcação removida." };
}
