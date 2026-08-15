"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { dataInputParaUTC } from "@/lib/data";

export type ContaReceberResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar o Financeiro.";

const FORMAS_PAGAMENTO = ["DINHEIRO", "PIX", "CARTAO", "BOLETO", "TRANSFERENCIA", "OUTRO"] as const;

// Sinaliza, de dentro da transação, que a conta já foi marcada como recebida
// entre a leitura inicial e a escrita — usado só pra abortar a transação
// inteira (sem criar o Pagamento) com mensagem amigável. Mesmo padrão de
// ErroComissaoJaPaga em comissoes/actions.ts.
class ErroContaJaRecebida extends Error {}

function revalidarContasReceber(orcamentoId?: string) {
  revalidatePath("/financeiro/contas-receber");
  revalidatePath("/financeiro");
  if (orcamentoId) revalidatePath(`/orcamento/${orcamentoId}`);
}

const criarSchema = z.object({
  orcamentoId: z.string().min(1),
  descricao: z.string().trim().min(1, "Informe uma descrição.").max(160),
  valor: z.coerce.number().finite().positive("Informe um valor maior que zero."),
  vencimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de vencimento inválida")
    .transform((v) => dataInputParaUTC(v)),
});

// Cria uma parcela/pagamento esperado pra um orçamento já aprovado — sempre
// lançamento MANUAL (ver comentário no model ContaReceber no schema), nunca
// gerado automaticamente na aprovação. Isolamento de tenant: o orçamento
// precisa pertencer à gráfica do usuário logado E estar APROVADO, nunca
// confiar só no orcamentoId vindo do form.
export async function criarContaReceber(
  _estadoAnterior: ContaReceberResult | null,
  formData: FormData
): Promise<ContaReceberResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = criarSchema.safeParse({
    orcamentoId: formData.get("orcamentoId"),
    descricao: formData.get("descricao"),
    valor: formData.get("valor"),
    vencimento: formData.get("vencimento"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { orcamentoId, descricao, valor, vencimento } = parsed.data;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    select: { id: true, status: true },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "APROVADO") {
    return {
      ok: false,
      mensagem: "Só é possível cadastrar conta a receber em um orçamento aprovado.",
    };
  }

  const conta = await prisma.contaReceber.create({
    data: { graficaId: usuario.graficaId, orcamentoId, descricao, valor, vencimento },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "conta_receber.criar",
    entidade: "ContaReceber",
    entidadeId: conta.id,
    descricao: `Conta a receber "${descricao}" cadastrada (${formatoMoeda.format(valor)}) no orçamento #${orcamentoId.slice(-6)}`,
  });

  revalidarContasReceber(orcamentoId);
  return { ok: true, mensagem: "Conta a receber cadastrada." };
}

const idSchema = z.object({ id: z.string().min(1) });

const marcarComoRecebidoSchema = z.object({
  id: z.string().min(1),
  forma: z.enum(FORMAS_PAGAMENTO),
  // Só usado quando forma = OUTRO — mesmo par de Pagamento.formaDetalhe.
  formaDetalhe: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

// Compare-and-swap via updateMany (where status: PENDENTE) pra evitar dupla
// marcação concorrente — mesmo cuidado usado em outros lugares deste sistema
// pra evitar corrida (ex: increment/decrement atômico em
// lancarMovimentacaoContaPrepaga). O findFirst antes só serve pra buscar os
// dados pra mensagem/auditoria — quem decide se a marcação vale é o
// updateMany, checando count > 0.
//
// Também cria um Pagamento vinculado (achado de auditoria pré-lançamento,
// 2026-08-15): até então, marcar aqui como recebido só mudava o status desta
// tabela — o CSV pro contador (financeiro/exportar/route.ts, que só lê o
// model Pagamento) subestimava receita sempre que o recebimento era
// registrado por este botão em vez de um Pagamento lançado manualmente na
// tela do orçamento. Mesmo padrão de marcarComissaoPaga (comissoes/actions.ts).
// Risco aceito, sem deduplicação automática: se alguém lançar os dois pro
// mesmo dinheiro, ele conta 2x no relatório.
export async function marcarComoRecebido(
  _estadoAnterior: ContaReceberResult | null,
  formData: FormData
): Promise<ContaReceberResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = marcarComoRecebidoSchema.safeParse({
    id: formData.get("id"),
    forma: formData.get("forma"),
    formaDetalhe: formData.get("formaDetalhe") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { id, forma, formaDetalhe } = parsed.data;

  const conta = await prisma.contaReceber.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });
  if (!conta) {
    return { ok: false, mensagem: "Conta a receber não encontrada." };
  }

  const agora = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const cas = await tx.contaReceber.updateMany({
        where: { id, graficaId: usuario.graficaId, status: "PENDENTE" },
        data: { status: "RECEBIDO", recebidoEm: agora },
      });
      if (cas.count === 0) {
        throw new ErroContaJaRecebida();
      }

      const pagamento = await tx.pagamento.create({
        data: {
          orcamentoId: conta.orcamentoId,
          valor: conta.valor,
          forma,
          formaDetalhe: formaDetalhe ?? null,
          observacao: `Gerado ao marcar "${conta.descricao}" como recebida`,
        },
      });
      await tx.contaReceber.update({
        where: { id },
        data: { pagamentoId: pagamento.id },
      });
    });
  } catch (erro) {
    if (erro instanceof ErroContaJaRecebida) {
      return { ok: false, mensagem: "Essa conta já foi recebida ou cancelada." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "conta_receber.marcar_recebido",
    entidade: "ContaReceber",
    entidadeId: id,
    descricao: `Conta a receber "${conta.descricao}" marcada como recebida (${formatoMoeda.format(Number(conta.valor))})`,
  });

  revalidarContasReceber(conta.orcamentoId);
  return { ok: true, mensagem: "Conta marcada como recebida." };
}

// Soft-cancel — nunca deleta (mesmo princípio de Despesa/ContaPrepaga: nunca
// apagar histórico financeiro). Também compare-and-swap: só cancela se ainda
// estiver PENDENTE (cancelar algo já recebido não faz sentido — a correção
// nesse caso é outra, não coberta aqui).
export async function cancelarContaReceber(
  _estadoAnterior: ContaReceberResult | null,
  formData: FormData
): Promise<ContaReceberResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return { ok: false, mensagem: "Dados inválidos." };
  }
  const { id } = parsed.data;

  const conta = await prisma.contaReceber.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });
  if (!conta) {
    return { ok: false, mensagem: "Conta a receber não encontrada." };
  }

  const { count } = await prisma.contaReceber.updateMany({
    where: { id, graficaId: usuario.graficaId, status: "PENDENTE" },
    data: { status: "CANCELADO" },
  });
  if (count === 0) {
    return { ok: false, mensagem: "Só é possível cancelar uma conta pendente." };
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "conta_receber.cancelar",
    entidade: "ContaReceber",
    entidadeId: id,
    descricao: `Conta a receber "${conta.descricao}" cancelada (${formatoMoeda.format(Number(conta.valor))})`,
  });

  revalidarContasReceber(conta.orcamentoId);
  return { ok: true, mensagem: "Conta cancelada." };
}
