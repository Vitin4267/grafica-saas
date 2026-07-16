"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { TRANSICOES_VALIDAS, type StatusOrcamento } from "@/lib/orcamento-status";

export type ResponderPublicoResult = { ok: boolean; mensagem: string };

// Sem autenticação: o próprio token é o "credencial" — dá acesso de leitura/decisão
// só sobre ESTE orçamento, nunca sobre a conta da gráfica.
export async function responderOrcamentoPublico(
  _estadoAnterior: ResponderPublicoResult | null,
  formData: FormData
): Promise<ResponderPublicoResult> {
  const token = String(formData.get("token"));
  const decisao = String(formData.get("decisao"));

  if (decisao !== "APROVADO" && decisao !== "REJEITADO") {
    return { ok: false, mensagem: "Ação inválida." };
  }

  const orcamento = await prisma.orcamento.findUnique({
    where: { linkPublicoToken: token },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  // Mesma máquina de estados da action autenticada — o cliente só pode decidir
  // a partir de ENVIADO, nunca "enviar" o próprio orçamento.
  const permitido = TRANSICOES_VALIDAS[orcamento.status as StatusOrcamento]?.includes(
    decisao as StatusOrcamento
  );
  if (!permitido) {
    return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
  }

  // Compare-and-swap: o updateMany só transiciona se o status AINDA for o que
  // acabamos de validar. Sem isso, o cliente aprovando pelo link público e um
  // funcionário rejeitando no painel ao mesmo tempo poderiam ambos passar na
  // checagem de transição e o último a gravar venceria — deixando, por
  // exemplo, um Pedido criado mas o orçamento marcado como REJEITADO (mesmo
  // padrão de guarda que producao/actions.ts já usa em avancarPedido).
  if (decisao === "APROVADO") {
    const resultado = await prisma.$transaction(async (tx) => {
      const cas = await tx.orcamento.updateMany({
        where: { id: orcamento.id, status: orcamento.status },
        data: { status: "APROVADO" },
      });
      if (cas.count === 0) return false;
      await tx.pedido.upsert({
        where: { orcamentoId: orcamento.id },
        update: {},
        create: { graficaId: orcamento.graficaId, orcamentoId: orcamento.id, status: "FILA" },
      });
      return true;
    });
    if (!resultado) {
      return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
    }
  } else {
    const cas = await prisma.orcamento.updateMany({
      where: { id: orcamento.id, status: orcamento.status },
      data: { status: "REJEITADO" },
    });
    if (cas.count === 0) {
      return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
    }
  }

  revalidatePath(`/o/${token}`);
  revalidatePath(`/orcamento/${orcamento.id}`);
  revalidatePath("/orcamento");
  if (decisao === "APROVADO") revalidatePath("/producao");

  return {
    ok: true,
    mensagem: decisao === "APROVADO" ? "Orçamento aprovado!" : "Orçamento recusado.",
  };
}
