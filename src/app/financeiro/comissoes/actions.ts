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

const MENSAGEM_CONFLITO_CONCORRENTE =
  "Esta comissão já foi marcada como paga por outra pessoa — recarregue a página.";

// Sinaliza, de dentro da transação, que a comissão já foi marcada como paga
// entre a leitura inicial e a escrita (duplo clique, duas abas, dois
// dispositivos) — usado só pra abortar a transação inteira (sem criar a
// Despesa) com uma mensagem amigável. Não é um erro de banco de verdade.
class ErroComissaoJaPaga extends Error {}

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
  try {
    await prisma.$transaction(async (tx) => {
      // Compare-and-swap: o updateMany só marca como PAGA se o status ainda
      // for PENDENTE. Sem isso, duas requisições concorrentes (duplo clique,
      // duas abas, dois dispositivos) passariam ambas pela leitura acima
      // antes de qualquer uma escrever, e cada uma criaria sua própria
      // Despesa — a segunda sobrescrevendo o despesaId da primeira e
      // deixando uma Despesa órfã duplicada no relatório financeiro (mesmo
      // padrão de guarda que status-transicao.ts e o/[token]/actions.ts já
      // usam). A Despesa só é criada DEPOIS de confirmar que este updateMany
      // teve sucesso.
      const cas = await tx.comissao.updateMany({
        where: { id: comissaoId, status: "PENDENTE" },
        data: { status: "PAGA", pagoEm: agora },
      });
      if (cas.count === 0) {
        throw new ErroComissaoJaPaga();
      }

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
        data: { despesaId: despesa.id },
      });
    });
  } catch (erro) {
    if (erro instanceof ErroComissaoJaPaga) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  revalidatePath("/financeiro/comissoes");
  revalidatePath("/financeiro");

  return { ok: true, mensagem: "Comissão marcada como paga." };
}
