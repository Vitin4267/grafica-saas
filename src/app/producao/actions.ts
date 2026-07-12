"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import type { Prisma } from "@/generated/prisma/client";
import { buscarWebhookAutomacao, dispararEventoAutomacao } from "@/lib/webhook-automacao";
import { normalizarTelefone } from "@/lib/telefone";
import { cruzouLimiteMinimo } from "@/lib/estoque-critico";

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
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }
  const pedidoId = String(formData.get("pedidoId"));

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    include: { orcamento: { include: { cliente: true } } },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  const indiceAtual = SEQUENCIA.indexOf(pedido.status as StatusPedido);
  if (indiceAtual === -1) {
    // Defensivo: hoje inalcançável (status é enum do banco restrito aos 5
    // valores de SEQUENCIA), mas sem essa checagem um status fora da lista
    // faria SEQUENCIA[-1+1] resolver silenciosamente pra SEQUENCIA[0]
    // ("FILA") — regredindo o pedido em vez de dar erro.
    return { ok: false, mensagem: "Status do pedido inválido." };
  }
  if (indiceAtual === SEQUENCIA.length - 1) {
    return { ok: false, mensagem: "Este pedido já está no status final." };
  }

  const proximoStatus = SEQUENCIA[indiceAtual + 1];
  const statusAnterior = pedido.status;

  // Buscado uma única vez e reaproveitado pros dois tipos de evento disparados
  // abaixo (estoque_critico e pedido_status_mudou) — evita duas idas ao banco
  // só pra ler a mesma URL.
  const webhookUrl = await buscarWebhookAutomacao(usuario.graficaId);

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
                fichaTecnica: {
                  include: {
                    materiaPrima: { include: { itemCatalogo: true } },
                    variante: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const operacoes: Prisma.PrismaPromise<unknown>[] = [
      prisma.pedido.update({ where: { id: pedidoId }, data: { status: proximoStatus } }),
    ];

    // Coletado durante o loop e disparado só DEPOIS que a transação confirmar
    // — evita mandar aviso de estoque crítico pra uma baixa que pode não ter
    // sido de fato persistida.
    const eventosEstoqueCritico: { itemNome: string; estoqueAtual: number; estoqueMinimo: number }[] = [];

    for (const item of orcamentoComItens?.itens ?? []) {
      for (const ficha of item.itemGrafica.fichaTecnica) {
        // Com variante (ex: espessura de chapa), o saldo de estoque é o da
        // variante, não o do ItemGrafica "pai" — cada variante é fisicamente
        // um estoque separado. Sem variante, comportamento de sempre.
        const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
        if (estoqueAtual === null) continue; // sem controle de estoque
        const quantidadeConsumida = Number(ficha.quantidadePorUnidade) * item.quantidade;
        const estoqueDepois = Number(estoqueAtual) - quantidadeConsumida;

        if (ficha.varianteId) {
          operacoes.push(
            prisma.varianteMateriaPrima.update({
              where: { id: ficha.varianteId },
              data: { estoqueAtual: { decrement: quantidadeConsumida } },
            })
          );
        } else {
          operacoes.push(
            prisma.itemGrafica.update({
              where: { id: ficha.materiaPrimaId },
              data: { estoqueAtual: { decrement: quantidadeConsumida } },
            })
          );
        }
        operacoes.push(
          prisma.movimentacaoEstoque.create({
            data: {
              itemGraficaId: ficha.materiaPrimaId,
              varianteId: ficha.varianteId,
              pedidoId: pedido.id,
              tipo: "SAIDA",
              quantidade: quantidadeConsumida,
              motivo: `Produção do pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
            },
          })
        );

        const estoqueMinimo = ficha.variante ? ficha.variante.estoqueMinimo : ficha.materiaPrima.estoqueMinimo;
        if (cruzouLimiteMinimo(Number(estoqueAtual), estoqueDepois, estoqueMinimo === null ? null : Number(estoqueMinimo))) {
          eventosEstoqueCritico.push({
            itemNome: ficha.materiaPrima.itemCatalogo.nome,
            estoqueAtual: estoqueDepois,
            estoqueMinimo: Number(estoqueMinimo),
          });
        }
      }
    }

    await prisma.$transaction(operacoes);

    if (webhookUrl) {
      for (const evento of eventosEstoqueCritico) {
        void dispararEventoAutomacao(webhookUrl, {
          tipo: "estoque_critico",
          graficaNome: usuario.grafica.nome,
          ...evento,
        });
      }
    }
  } else {
    await prisma.pedido.update({
      where: { id: pedidoId },
      data: { status: proximoStatus },
    });
  }

  if (webhookUrl) {
    void dispararEventoAutomacao(webhookUrl, {
      tipo: "pedido_status_mudou",
      graficaNome: usuario.grafica.nome,
      clienteNome: pedido.orcamento.cliente.nome,
      clienteTelefone: normalizarTelefone(pedido.orcamento.cliente.telefone),
      statusAnterior,
      statusNovo: proximoStatus,
      orcamentoId: pedido.orcamentoId,
    });
  }

  revalidatePath("/producao");
  revalidatePath(`/orcamento/${pedido.orcamentoId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: `Avançado para ${ROTULOS[proximoStatus]}.` };
}
