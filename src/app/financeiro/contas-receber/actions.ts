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
import { ROTULO_TRIBUTO_RETIDO } from "@/lib/retencao-conta-receber";

export type ContaReceberResult = { ok: boolean; mensagem: string };

// Achado A9 da Parte 4 da auditoria de abrangência (2026-09-09) — mesma
// duplicação local de valores de enum já usada em FORMAS_PAGAMENTO abaixo (o
// zod schema precisa de uma tupla literal, não do array TributoRetido[]
// exportado por src/lib/retencao-conta-receber.ts).
const TRIBUTOS_RETIDOS = ["IRRF", "CSRF", "PIS", "COFINS", "CSLL", "ISS", "INSS", "OUTRO"] as const;

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar o Financeiro.";

// Achado A11 da Parte 4 da auditoria de abrangência (2026-09-08) — CARTAO
// continua na lista (legado) ao lado dos valores novos e específicos.
const FORMAS_PAGAMENTO = [
  "DINHEIRO",
  "PIX",
  "CARTAO",
  "CARTAO_CREDITO",
  "CARTAO_DEBITO",
  "BOLETO",
  "CHEQUE",
  "TRANSFERENCIA",
  "OUTRO",
] as const;

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
  // Achado A11 da Parte 4 da auditoria de abrangência (2026-09-08) — quanto
  // de taxa (maquininha/antecipação) foi de fato cobrado neste recebimento.
  // Opcional: ausente/vazio vira 0 (comportamento de hoje preservado 100%).
  // Pode vir pré-preenchido pelo client a partir de TaxaFormaPagamento
  // cadastrada, mas sempre editável.
  valorTaxa: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 0))
    .refine((v) => Number.isFinite(v) && v >= 0, { message: "Valor de taxa inválido." }),
  // Achado A5 da Parte 4 da auditoria de abrangência (2026-09-09) — quanto
  // de juros de mora / multa por atraso foi de fato cobrado neste
  // recebimento. Opcional: ausente/vazio vira 0 (comportamento de hoje
  // preservado 100%). Pode vir pré-preenchido no client a partir de
  // ParametrosGrafica.jurosMoraMensalPercent/multaAtrasoPercent × dias de
  // atraso, mas sempre editável — nunca calculado sozinho no servidor.
  valorJuros: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 0))
    .refine((v) => Number.isFinite(v) && v >= 0, { message: "Valor de juros inválido." }),
  valorMulta: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 0))
    .refine((v) => Number.isFinite(v) && v >= 0, { message: "Valor de multa inválido." }),
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
    valorTaxa: formData.get("valorTaxa") ?? undefined,
    valorJuros: formData.get("valorJuros") ?? undefined,
    valorMulta: formData.get("valorMulta") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { id, forma, formaDetalhe, valorTaxa, valorJuros, valorMulta } = parsed.data;

  const conta = await prisma.contaReceber.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });
  if (!conta) {
    return { ok: false, mensagem: "Conta a receber não encontrada." };
  }
  // Achado A5 da Parte 4 (2026-09-09) — EM_COBRANCA aceita baixa igual a
  // PENDENTE/PARCIAL: uma conta em processo de cobrança ainda pode ser
  // recebida (é exatamente o objetivo de cobrar). PERDA/CANCELADO/RECEBIDO
  // continuam bloqueados.
  if (conta.status !== "PENDENTE" && conta.status !== "PARCIAL" && conta.status !== "EM_COBRANCA") {
    return { ok: false, mensagem: "Essa conta já foi recebida, cancelada ou marcada como perda." };
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
          valorTaxa,
          valorJuros,
          valorMulta,
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

// Achado A5 da Parte 4 da auditoria de abrangência (2026-09-09) — "régua de
// cobrança", fatia 1 (status honesto). Nenhuma transição automática: é
// sempre o usuário marcando manualmente que uma conta vencida entrou em
// processo de cobrança (negociação, ligação, escalonamento interno — o
// MECANISMO de cobrança em si continua fora do sistema, deliberadamente —
// ver comentário na migration sobre a fatia 3, fora de escopo). Mesmo
// padrão CAS de registrarBaixaContaReceber: só marca se ainda estiver
// PENDENTE/PARCIAL, pra não sobrescrever uma baixa/cancelamento que
// aconteceu entre a leitura e a escrita.
export async function marcarContaReceberEmCobranca(
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
    where: { id, graficaId: usuario.graficaId, status: { in: ["PENDENTE", "PARCIAL"] } },
    data: { status: "EM_COBRANCA" },
  });
  if (count === 0) {
    return { ok: false, mensagem: "Só é possível marcar como em cobrança uma conta pendente ou parcial." };
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "conta_receber.marcar_em_cobranca",
    entidade: "ContaReceber",
    entidadeId: id,
    descricao: `Conta a receber "${conta.descricao}" (${formatoMoeda.format(Number(conta.valor))}) marcada como em cobrança`,
  });

  revalidarContasReceber(conta.orcamentoId);
  return { ok: true, mensagem: "Conta marcada como em cobrança." };
}

// Achado A5 da Parte 4 da auditoria de abrangência (2026-09-09) — "régua de
// cobrança", fatia 1: baixa por PERDA (calote reconhecido), distinta de
// CANCELADO (erro de digitação/pedido cancelado) — até aqui os dois casos
// eram indistinguíveis no relatório. Soft-write-off: não deleta nada, não
// mexe em BaixaContaReceber (baixas parciais já recebidas antes de a conta
// ser dada como perdida continuam registradas normalmente — só o SALDO
// remanescente é que é reconhecido como não recebível). Aceita PENDENTE,
// PARCIAL ou EM_COBRANCA como origem — uma conta pode ir direto pra perda
// sem passar por cobrança formal.
export async function marcarContaReceberPerda(
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
    where: { id, graficaId: usuario.graficaId, status: { in: ["PENDENTE", "PARCIAL", "EM_COBRANCA"] } },
    data: { status: "PERDA" },
  });
  if (count === 0) {
    return { ok: false, mensagem: "Só é possível marcar como perda uma conta pendente, parcial ou em cobrança." };
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "conta_receber.marcar_perda",
    entidade: "ContaReceber",
    entidadeId: id,
    descricao: `Conta a receber "${conta.descricao}" (${formatoMoeda.format(Number(conta.valor))}) marcada como perda`,
  });

  revalidarContasReceber(conta.orcamentoId);
  return { ok: true, mensagem: "Conta marcada como perda." };
}

// Achado A9 da Parte 4 da auditoria de abrangência (2026-09-09) — registro
// (declarativo, ver comentário no schema em ContaReceber.valorRetencoes) de
// um tributo retido na fonte pelo tomador desta conta. Puramente
// informativo: só grava a linha e ATUALIZA valorRetencoes por soma (nunca
// mexe em status/pagamentoId/BaixaContaReceber — conciliação automática
// continua fora de escopo). Pode ter mais de uma linha por conta (ex: ISS +
// IRRF juntos).
const criarRetencaoSchema = z.object({
  contaReceberId: z.string().min(1),
  tributo: z.enum(TRIBUTOS_RETIDOS),
  // Só obrigatório quando tributo=OUTRO — validado abaixo (zod não expressa
  // essa dependência condicional de forma direta, mesmo padrão de
  // validarSegmento em src/app/clientes/actions.ts).
  tributoOutro: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : undefined)),
  percentual: z.coerce.number().finite().min(0).max(100, "Percentual inválido."),
  valor: z.coerce.number().finite().positive("Informe um valor de retenção maior que zero."),
});

export async function criarRetencaoContaReceber(
  _estadoAnterior: ContaReceberResult | null,
  formData: FormData
): Promise<ContaReceberResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = criarRetencaoSchema.safeParse({
    contaReceberId: formData.get("contaReceberId"),
    tributo: formData.get("tributo"),
    tributoOutro: formData.get("tributoOutro") ?? undefined,
    percentual: formData.get("percentual"),
    valor: formData.get("valor"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { contaReceberId, tributo, valor, percentual } = parsed.data;
  if (tributo === "OUTRO" && !parsed.data.tributoOutro) {
    return { ok: false, mensagem: 'Descreva o tributo quando escolher "Outro".' };
  }
  const tributoOutro = tributo === "OUTRO" ? (parsed.data.tributoOutro ?? null) : null;

  const conta = await prisma.contaReceber.findFirst({
    where: { id: contaReceberId, graficaId: usuario.graficaId },
  });
  if (!conta) {
    return { ok: false, mensagem: "Conta a receber não encontrada." };
  }

  await prisma.$transaction([
    prisma.retencaoContaReceber.create({
      data: {
        graficaId: usuario.graficaId,
        contaReceberId,
        tributo,
        tributoOutro,
        percentual,
        valor,
      },
    }),
    prisma.contaReceber.update({
      where: { id: contaReceberId },
      data: { valorRetencoes: { increment: valor } },
    }),
  ]);

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "conta_receber.criar_retencao",
    entidade: "ContaReceber",
    entidadeId: contaReceberId,
    descricao: `Retenção de ${ROTULO_TRIBUTO_RETIDO[tributo] ?? tributo} (${formatoMoeda.format(valor)}) registrada na conta a receber "${conta.descricao}"`,
  });

  revalidarContasReceber(conta.orcamentoId);
  return { ok: true, mensagem: "Retenção registrada." };
}

const excluirRetencaoSchema = z.object({ id: z.string().min(1) });

// Hard delete — diferente do soft-cancel de ContaReceber/Despesa: uma
// RetencaoContaReceber é só um lançamento informativo digitado errado ou
// desfeito, sem histórico financeiro real associado (nenhum Pagamento nem
// BaixaContaReceber referencia esta tabela), então não há motivo pra manter
// registro de exclusão.
export async function excluirRetencaoContaReceber(
  _estadoAnterior: ContaReceberResult | null,
  formData: FormData
): Promise<ContaReceberResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = excluirRetencaoSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return { ok: false, mensagem: "Dados inválidos." };
  }
  const { id } = parsed.data;

  const retencao = await prisma.retencaoContaReceber.findFirst({
    where: { id, graficaId: usuario.graficaId },
    include: { contaReceber: { select: { id: true, orcamentoId: true, descricao: true } } },
  });
  if (!retencao) {
    return { ok: false, mensagem: "Retenção não encontrada." };
  }

  await prisma.$transaction([
    prisma.retencaoContaReceber.delete({ where: { id } }),
    prisma.contaReceber.update({
      where: { id: retencao.contaReceberId },
      data: { valorRetencoes: { decrement: retencao.valor } },
    }),
  ]);

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "conta_receber.excluir_retencao",
    entidade: "ContaReceber",
    entidadeId: retencao.contaReceberId,
    descricao: `Retenção de ${ROTULO_TRIBUTO_RETIDO[retencao.tributo] ?? retencao.tributo} (${formatoMoeda.format(Number(retencao.valor))}) removida da conta a receber "${retencao.contaReceber.descricao}"`,
  });

  revalidarContasReceber(retencao.contaReceber.orcamentoId);
  return { ok: true, mensagem: "Retenção removida." };
}
