"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { dataInputParaUTC } from "@/lib/data";

const FORMAS_PAGAMENTO = ["DINHEIRO", "PIX", "CARTAO", "BOLETO", "TRANSFERENCIA", "OUTRO"] as const;

export type ComissaoResult = { ok: boolean; mensagem: string };

const marcarComissaoPagaSchema = z.object({
  comissaoId: z.string().min(1),
  formaPagamento: z.enum(FORMAS_PAGAMENTO),
});

// Marcar uma comissão como paga também cria uma Despesa vinculada
// (categoria "Comissão") — assim o pagamento aparece no relatório/exportação
// financeira normal (src/app/financeiro/exportar/route.ts) sem duplicar os
// campos de valor/data em dois lugares. A Despesa nasce já PAGA (o
// vencimento é a data de hoje, sem sentido "vencimento futuro" pra algo que
// já está sendo pago agora).
export async function marcarComissaoPaga(
  _estadoAnterior: ComissaoResult | null,
  formData: FormData
): Promise<ComissaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }

  const parsed = marcarComissaoPagaSchema.safeParse({
    comissaoId: formData.get("comissaoId"),
    formaPagamento: formData.get("formaPagamento"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { comissaoId, formaPagamento } = parsed.data;

  const comissao = await prisma.comissao.findFirst({
    where: { id: comissaoId, graficaId: usuario.graficaId },
    include: { usuario: { select: { nome: true } }, orcamento: { select: { id: true } } },
  });
  if (!comissao) {
    return { ok: false, mensagem: "Comissão não encontrada." };
  }
  if (comissao.status === "PAGA") {
    return { ok: false, mensagem: "Esta comissão já está marcada como paga." };
  }

  const agora = new Date();
  await prisma.$transaction(async (tx) => {
    const despesa = await tx.despesa.create({
      data: {
        graficaId: usuario.graficaId,
        descricao: `Comissão de ${comissao.usuario.nome} — orçamento ${comissao.orcamento.id}`,
        categoria: "Comissão",
        valor: comissao.valorComissao,
        vencimento: dataInputParaUTC(agora.toISOString().slice(0, 10)),
        status: "PAGA",
        formaPagamento,
        pagoEm: agora,
      },
    });
    await tx.comissao.update({
      where: { id: comissaoId },
      data: { status: "PAGA", pagoEm: agora, despesaId: despesa.id },
    });
  });

  revalidatePath("/financeiro/comissoes");
  revalidatePath("/financeiro");

  return { ok: true, mensagem: "Comissão marcada como paga." };
}
