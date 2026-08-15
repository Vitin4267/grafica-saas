"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { D } from "@/lib/pricing/decimal";

export type ContaPrepagaResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar o Financeiro.";

// Cria uma nova "carteira" prepaga (ex: Lalamove) pra gráfica — saldo nasce
// zerado, a primeira recarga é lançada depois na tela de detalhe (mesmo
// espírito de criarCategoriaCusto: criar primeiro, popular depois).
// @@unique([graficaId, nome]) no schema já impede duplicata; tratamos o
// P2002 com mensagem amigável em vez de deixar o erro genérico do Prisma
// vazar pro usuário.
export async function criarContaPrepaga(
  _estadoAnterior: ContaPrepagaResult | null,
  formData: FormData
): Promise<ContaPrepagaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const nome = String(formData.get("nome") ?? "").trim().slice(0, 120);
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a conta." };
  }

  let conta: { id: string };
  try {
    conta = await prisma.contaPrepaga.create({
      data: { graficaId: usuario.graficaId, nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma conta prepaga com esse nome." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "conta_prepaga.criar",
    entidade: "ContaPrepaga",
    entidadeId: conta.id,
    descricao: `Criou a conta prepaga "${nome}"`,
  });

  revalidatePath("/financeiro/contas-prepagas");
  redirect(`/financeiro/contas-prepagas/${conta.id}`);
}

const movimentacaoSchema = z.object({
  contaId: z.string().min(1),
  tipo: z.enum(["RECARGA", "DEBITO"]),
  valor: z.coerce.number().positive("Informe um valor maior que zero."),
  motivo: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

// Lança uma recarga ou débito na conta prepaga. Decisão de produto (ver
// tarefa): NÃO bloqueia um DEBITO que deixaria o saldo negativo — a
// planilha real da gráfica cliente mostra o saldo chegando bem perto de
// zero com frequência (ex: corrida do Lalamove sai antes da próxima
// recarga cair), e travar geraria fricção sem benefício real. A tela de
// detalhe já mostra um aviso visual quando o saldo fica baixo; negativo
// continua visível ali (mesmo estilo, só mais evidente).
// createMovimentacao + updateSaldo sempre na MESMA transação, pra nunca
// ficar dessincronizado (saldoAtual é cache redundante da soma das
// movimentações, ver comentário no schema).
export async function lancarMovimentacaoContaPrepaga(
  _estadoAnterior: ContaPrepagaResult | null,
  formData: FormData
): Promise<ContaPrepagaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = movimentacaoSchema.safeParse({
    contaId: formData.get("contaId"),
    tipo: formData.get("tipo"),
    valor: formData.get("valor"),
    motivo: formData.get("motivo") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const { contaId, tipo, valor, motivo } = parsed.data;

  // Isolamento de tenant: a conta precisa pertencer à gráfica do usuário
  // logado, nunca confiar só no contaId vindo do form.
  const conta = await prisma.contaPrepaga.findFirst({
    where: { id: contaId, graficaId: usuario.graficaId },
  });
  if (!conta) {
    return { ok: false, mensagem: "Conta não encontrada." };
  }

  const valorDec = new D(valor);

  const movimentacao = await prisma.$transaction(async (tx) => {
    const mov = await tx.movimentacaoContaPrepaga.create({
      data: {
        contaId: conta.id,
        tipo,
        valor: valorDec.toFixed(2),
        motivo: motivo ?? null,
        criadoPorId: usuario.id,
      },
    });
    // increment/decrement é atômico no banco (UPDATE ... SET saldoAtual =
    // saldoAtual ± valor) — ler o saldo antes e calcular na mão (jeito
    // original) tinha uma corrida real: duas movimentações concorrentes
    // lendo o mesmo saldo "antigo" fariam a última escrita vencer,
    // desalinhando o saldo em cache da soma de verdade das movimentações
    // (o histórico ficaria certo, só o saldo mostrado ficaria errado).
    await tx.contaPrepaga.update({
      where: { id: conta.id },
      data:
        tipo === "RECARGA"
          ? { saldoAtual: { increment: valorDec.toFixed(2) } }
          : { saldoAtual: { decrement: valorDec.toFixed(2) } },
    });
    return mov;
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: tipo === "RECARGA" ? "conta_prepaga.recarga" : "conta_prepaga.debito",
    entidade: "MovimentacaoContaPrepaga",
    entidadeId: movimentacao.id,
    descricao: `${tipo === "RECARGA" ? "Recarregou" : "Debitou"} ${formatoMoeda.format(valor)} na conta "${conta.nome}"${
      motivo ? ` — ${motivo}` : ""
    }`,
  });

  revalidatePath(`/financeiro/contas-prepagas/${contaId}`);
  revalidatePath("/financeiro/contas-prepagas");
  return { ok: true, mensagem: tipo === "RECARGA" ? "Recarga lançada." : "Débito lançado." };
}
