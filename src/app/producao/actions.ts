"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import type { Prisma } from "@/generated/prisma/client";

export type AvancarPedidoResult = { ok: boolean; mensagem: string };

type StatusPedido = "FILA" | "IMPRESSAO" | "ACABAMENTO" | "PRONTO" | "ENTREGUE";

const SEQUENCIA: StatusPedido[] = ["FILA", "IMPRESSAO", "ACABAMENTO", "PRONTO", "ENTREGUE"];

const ROTULOS: Record<StatusPedido, string> = {
  FILA: "Na fila",
  IMPRESSAO: "Impressão",
  ACABAMENTO: "Acabamento",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
};

export async function avancarPedido(
  _estadoAnterior: AvancarPedidoResult | null,
  formData: FormData
): Promise<AvancarPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  const pedidoId = String(formData.get("pedidoId"));

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  // TODO(review): se pedido.status não estiver em SEQUENCIA por algum motivo
  // (enum estendido sem atualizar essa lista, valor alterado direto no banco),
  // indexOf retorna -1 e SEQUENCIA[-1+1] vira SEQUENCIA[0] ("FILA") silenciosamente
  // — o pedido regride pra fila em vez de dar erro. Hoje improvável (status é
  // enum do banco restrito aos 5 valores conhecidos), mas se acontecer, uma
  // passagem futura por FILA→IMPRESSAO dispararia a baixa de estoque de novo
  // (ver bloco abaixo). Valeria um `if (indiceAtual === -1) throw/return erro`.
  const indiceAtual = SEQUENCIA.indexOf(pedido.status as StatusPedido);
  if (indiceAtual === SEQUENCIA.length - 1) {
    return { ok: false, mensagem: "Este pedido já está no status final." };
  }

  const proximoStatus = SEQUENCIA[indiceAtual + 1];

  // Baixa automática de estoque: só na entrada em produção física (FILA→IMPRESSAO),
  // e só nessa transição específica — como o pedido só anda pra frente na SEQUENCIA
  // (sem revert), isso naturalmente garante que só desconta uma vez por pedido.
  // Sem mecanismo de estorno hoje: se o pedido for descontinuado depois disso, a
  // baixa não é desfeita automaticamente (ver plano — limitação conhecida).
  if (pedido.status === "FILA" && proximoStatus === "IMPRESSAO") {
    const orcamentoComItens = await prisma.orcamento.findUnique({
      where: { id: pedido.orcamentoId },
      include: {
        itens: {
          include: {
            itemGrafica: {
              include: {
                fichaTecnica: { include: { materiaPrima: true } },
              },
            },
          },
        },
      },
    });

    const operacoes: Prisma.PrismaPromise<unknown>[] = [
      prisma.pedido.update({ where: { id: pedidoId }, data: { status: proximoStatus } }),
    ];

    for (const item of orcamentoComItens?.itens ?? []) {
      for (const ficha of item.itemGrafica.fichaTecnica) {
        if (ficha.materiaPrima.estoqueAtual === null) continue; // sem controle de estoque
        const quantidadeConsumida = Number(ficha.quantidadePorUnidade) * item.quantidade;
        operacoes.push(
          prisma.itemGrafica.update({
            where: { id: ficha.materiaPrimaId },
            data: { estoqueAtual: { decrement: quantidadeConsumida } },
          }),
          prisma.movimentacaoEstoque.create({
            data: {
              itemGraficaId: ficha.materiaPrimaId,
              tipo: "SAIDA",
              quantidade: quantidadeConsumida,
              motivo: `Produção do pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
            },
          })
        );
      }
    }

    await prisma.$transaction(operacoes);
  } else {
    await prisma.pedido.update({
      where: { id: pedidoId },
      data: { status: proximoStatus },
    });
  }

  revalidatePath("/producao");
  revalidatePath(`/orcamento/${pedido.orcamentoId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: `Avançado para ${ROTULOS[proximoStatus]}.` };
}
