"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { D } from "@/lib/pricing/decimal";
import { lancarMovimentacaoManualCreditoCliente } from "@/lib/credito-cliente";

export type CreditoClienteResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar o Financeiro.";

// Só abre a tela de extrato de um cliente existente da gráfica — não cria
// nada no banco ainda (mesmo espírito de criarContaPrepaga, mas aqui não há
// "nome de conta" pra escolher: o registro CreditoCliente nasce sozinho no
// primeiro depósito, ver lancarMovimentacaoManualCreditoCliente).
export async function abrirCreditoCliente(
  _estadoAnterior: CreditoClienteResult | null,
  formData: FormData
): Promise<CreditoClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const clienteId = String(formData.get("clienteId") ?? "");
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
    select: { id: true },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  redirect(`/financeiro/creditos-clientes/${cliente.id}`);
}

const movimentacaoSchema = z.object({
  clienteId: z.string().min(1),
  tipo: z.enum(["DEPOSITO", "ESTORNO", "AJUSTE"]),
  valor: z.coerce.number().positive("Informe um valor maior que zero."),
  // Só lido quando tipo=AJUSTE (ver comentário abaixo) — ignorado nos
  // outros dois tipos, sempre positivos.
  direcaoAjuste: z.enum(["AUMENTAR", "DIMINUIR"]).optional(),
  descricao: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

const ROTULO_TIPO: Record<string, string> = {
  DEPOSITO: "Depósito",
  ESTORNO: "Estorno",
  AJUSTE: "Ajuste",
};

// Lança um depósito/estorno/ajuste manual no crédito adiantado de um
// cliente. Igual a lancarMovimentacaoContaPrepaga: NÃO trava se o resultado
// ficar negativo (só CONSUMO, na aprovação de orçamento, tem essa trava —
// ver lancarConsumoCreditoCliente em src/lib/credito-cliente.ts). CONSUMO
// não é um tipo lançável por aqui de propósito: só nasce automaticamente
// quando um orçamento é aprovado usando o crédito do cliente.
export async function lancarMovimentacaoCreditoCliente(
  _estadoAnterior: CreditoClienteResult | null,
  formData: FormData
): Promise<CreditoClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = movimentacaoSchema.safeParse({
    clienteId: formData.get("clienteId"),
    tipo: formData.get("tipo"),
    valor: formData.get("valor"),
    direcaoAjuste: formData.get("direcaoAjuste") || undefined,
    descricao: formData.get("descricao") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const { clienteId, tipo, valor, direcaoAjuste, descricao } = parsed.data;

  // Isolamento de tenant: nunca confiar só no clienteId vindo do form.
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
    select: { id: true, nome: true },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  let valorDec = new D(valor);
  if (tipo === "AJUSTE" && direcaoAjuste === "DIMINUIR") {
    valorDec = valorDec.neg();
  }

  const resultado = await prisma.$transaction((tx) =>
    lancarMovimentacaoManualCreditoCliente(tx, {
      clienteId: cliente.id,
      tipo,
      valor: valorDec,
      descricao,
      criadoPorId: usuario.id,
    })
  );
  if (!resultado.ok) {
    return resultado;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "credito_cliente.movimentacao",
    entidade: "MovimentacaoCreditoCliente",
    entidadeId: resultado.movimentacaoId,
    descricao: `${ROTULO_TIPO[tipo]} de ${formatoMoeda.format(Math.abs(Number(valorDec)))} no crédito de "${cliente.nome}"${
      descricao ? ` — ${descricao}` : ""
    }`,
  });

  revalidatePath(`/financeiro/creditos-clientes/${clienteId}`);
  revalidatePath("/financeiro/creditos-clientes");
  return { ok: true, mensagem: `${ROTULO_TIPO[tipo]} lançado.` };
}
