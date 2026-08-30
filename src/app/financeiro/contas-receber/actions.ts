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
import { saldoContaReceber } from "@/lib/baixa-financeira";
import { paraDecimal } from "@/lib/pricing/decimal";

export type ContaReceberResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar o Financeiro.";

const FORMAS_PAGAMENTO = ["DINHEIRO", "PIX", "CARTAO", "BOLETO", "TRANSFERENCIA", "OUTRO"] as const;

// Sinaliza, de dentro da transação, que a conta já mudou de status (recebida,
// cancelada, ou baixada por outra requisição) entre a leitura inicial e a
// escrita — usado só pra abortar a transação inteira (sem criar o Pagamento)
// com mensagem amigável. Mesmo padrão de ErroComissaoJaPaga em
// comissoes/actions.ts.
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

// Cria uma parcela/pagamento esperado pra um orçamento já aprovado — o
// caminho MANUAL (ver comentário no model ContaReceber no schema). Desde o
// achado A7 da Parte 4 (2026-08-28) existe também um caminho AUTOMÁTICO —
// gerarContasReceberDaAprovacao em src/lib/condicao-pagamento.ts, disparado
// dentro da própria aprovação quando o orçamento tem uma CondicaoPagamento
// vinculada com âncora APROVACAO — mas este aqui continua sendo o único
// jeito de lançar uma parcela À MÃO, e nunca é substituído por ele: um
// orçamento sem condição vinculada (ou com condição de âncora ainda não
// plumbada) continua dependendo só deste formulário, como sempre. Isolamento
// de tenant: o orçamento precisa pertencer à gráfica do usuário logado E
// estar APROVADO, nunca confiar só no orcamentoId vindo do form.
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
    select: { id: true, status: true, clienteId: true },
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

  // Achado A10 da Parte 5 — mesmo preenchimento do caminho automático
  // (gerarContasReceberDaAprovacao, src/lib/condicao-pagamento.ts).
  const conta = await prisma.contaReceber.create({
    data: {
      graficaId: usuario.graficaId,
      orcamentoId,
      clienteId: orcamento.clienteId,
      descricao,
      valor,
      vencimento,
    },
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

const registrarBaixaSchema = z.object({
  id: z.string().min(1),
  forma: z.enum(FORMAS_PAGAMENTO),
  // Só usado quando forma = OUTRO — mesmo par de Pagamento.formaDetalhe.
  formaDetalhe: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Opcional (achado A8 da Parte 4, 2026-08-29): string vazia/ausente vira
  // undefined e a action usa o SALDO em aberto inteiro — preserva o
  // comportamento de sempre ("Marcar como recebido" = valor cheio) pra quem
  // não mexe no campo. Só quando preenchido com um valor MENOR que o saldo
  // é que vira um recebimento parcial de verdade.
  valor: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isFinite(v) && v > 0), {
      message: "Informe um valor maior que zero.",
    }),
});

// Compare-and-swap via updateMany (where status: status lido) pra evitar
// dupla baixa concorrente — mesmo cuidado usado em outros lugares deste
// sistema pra evitar corrida (ex: increment/decrement atômico em
// lancarMovimentacaoContaPrepaga). O findFirst antes só serve pra buscar os
// dados pra mensagem/auditoria/cálculo de saldo — quem decide se a baixa
// vale é o updateMany, checando count > 0.
//
// Sempre cria um Pagamento vinculado (achado de auditoria pré-lançamento,
// 2026-08-15): até então, marcar aqui como recebido só mudava o status desta
// tabela — o CSV pro contador (financeiro/exportar/route.ts, que só lê o
// model Pagamento) subestimava receita sempre que o recebimento era
// registrado por este botão em vez de um Pagamento lançado manualmente na
// tela do orçamento. Mesmo padrão de marcarComissaoPaga (comissoes/actions.ts).
// Risco aceito, sem deduplicação automática: se alguém lançar os dois pro
// mesmo dinheiro, ele conta 2x no relatório.
//
// Achado A8 da Parte 4 (2026-08-29) — recebimento PARCIAL: renomeada de
// marcarComoRecebido. Esta é a ÚNICA action que aplica um valor parcial, e
// só porque a conta já foi escolhida EXPLICITAMENTE pelo usuário (é sempre
// chamada a partir de UMA linha específica na tela de contas a receber,
// nunca por matching automático) — nunca "adivinha" qual conta entre várias
// em aberto. Quando o valor bate exato com o saldo total da conta (o
// comportamento de sempre, PENDENTE sem nenhuma baixa anterior), o caminho é
// IDÊNTICO ao de antes: mesmo update direto de pagamentoId, sem tocar em
// BaixaContaReceber. Só quando o valor é MENOR que o saldo em aberto (ou a
// conta já vinha de uma baixa parcial anterior) é que passa a gravar em
// BaixaContaReceber. Valor MAIOR que o saldo em aberto é rejeitado — nunca
// aplicado como parcial "com sobra" em silêncio (ver proposta do achado):
// quem quer registrar mais dinheiro do que falta nesta conta precisa
// primeiro corrigir o valor ou escolher outra conta.
export async function registrarBaixaContaReceber(
  _estadoAnterior: ContaReceberResult | null,
  formData: FormData
): Promise<ContaReceberResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = registrarBaixaSchema.safeParse({
    id: formData.get("id"),
    forma: formData.get("forma"),
    formaDetalhe: formData.get("formaDetalhe") ?? undefined,
    valor: formData.get("valor") ?? undefined,
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
  if (conta.status !== "PENDENTE" && conta.status !== "PARCIAL") {
    return { ok: false, mensagem: "Essa conta já foi recebida ou cancelada." };
  }

  const saldoAtual = await saldoContaReceber(prisma, conta);
  const valorNovo = paraDecimal(parsed.data.valor ?? saldoAtual.toFixed(2));
  if (valorNovo.gt(saldoAtual)) {
    return {
      ok: false,
      mensagem: `Valor informado (${formatoMoeda.format(valorNovo.toNumber())}) é maior que o saldo em aberto desta conta (${formatoMoeda.format(saldoAtual.toNumber())}). Ajuste o valor ou registre em outra conta.`,
    };
  }

  const statusLido = conta.status;
  const usaCaminhoLegado = statusLido === "PENDENTE" && valorNovo.eq(paraDecimal(conta.valor.toString()));
  const fechaConta = valorNovo.eq(saldoAtual);
  const agora = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const pagamento = await tx.pagamento.create({
        data: {
          orcamentoId: conta.orcamentoId,
          valor: valorNovo.toFixed(2),
          forma,
          formaDetalhe: formaDetalhe ?? null,
          observacao: `Gerado ao registrar baixa de "${conta.descricao}"`,
        },
      });

      if (usaCaminhoLegado) {
        // Caminho ANTIGO, preservado 100% — mesmo update direto de antes.
        const cas = await tx.contaReceber.updateMany({
          where: { id, status: "PENDENTE" },
          data: { status: "RECEBIDO", recebidoEm: agora, pagamentoId: pagamento.id },
        });
        if (cas.count === 0) throw new ErroContaJaRecebida();
        return;
      }

      // Caminho NOVO: baixa (parcial, ou fechamento de uma conta que já
      // vinha parcial) registrada em BaixaContaReceber — saldo recalculado
      // na próxima leitura, nunca armazenado.
      const cas = await tx.contaReceber.updateMany({
        where: { id, status: statusLido },
        data: fechaConta
          ? { status: "RECEBIDO", recebidoEm: agora }
          : { status: "PARCIAL" },
      });
      if (cas.count === 0) throw new ErroContaJaRecebida();

      await tx.baixaContaReceber.create({
        data: { contaReceberId: id, pagamentoId: pagamento.id, valor: valorNovo.toFixed(2) },
      });
    });
  } catch (erro) {
    if (erro instanceof ErroContaJaRecebida) {
      return { ok: false, mensagem: "Essa conta já foi recebida, cancelada ou baixada por outra requisição." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: fechaConta ? "conta_receber.marcar_recebido" : "conta_receber.baixa_parcial",
    entidade: "ContaReceber",
    entidadeId: id,
    descricao: fechaConta
      ? `Conta a receber "${conta.descricao}" marcada como recebida (${formatoMoeda.format(valorNovo.toNumber())})`
      : `Baixa parcial de ${formatoMoeda.format(valorNovo.toNumber())} registrada na conta a receber "${conta.descricao}" (saldo restante: ${formatoMoeda.format(saldoAtual.minus(valorNovo).toNumber())})`,
  });

  revalidarContasReceber(conta.orcamentoId);
  return {
    ok: true,
    mensagem: fechaConta ? "Conta marcada como recebida." : "Baixa parcial registrada.",
  };
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
