"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { despesaSchema, marcarComoPagaSchema } from "./schema";

export type DespesaResult = { ok: boolean; mensagem: string };

function revalidarFinanceiro(despesaId?: string) {
  revalidatePath("/financeiro");
  revalidatePath("/meu-negocio");
  if (despesaId) revalidatePath(`/financeiro/${despesaId}`);
}

export async function criarDespesa(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }

  const parsed = despesaSchema.safeParse({
    descricao: formData.get("descricao"),
    categoria: formData.get("categoria") ?? undefined,
    valor: formData.get("valor"),
    vencimento: formData.get("vencimento"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const recorrente = formData.get("recorrente") === "on";

  let despesa = await prisma.despesa.create({
    data: { graficaId: usuario.graficaId, ...parsed.data, recorrente },
  });

  // A primeira ocorrência de uma série usa o próprio id como
  // serieRecorrenciaId — precisa de um segundo update porque o id só existe
  // depois do create.
  if (recorrente) {
    despesa = await prisma.despesa.update({
      where: { id: despesa.id },
      data: { serieRecorrenciaId: despesa.id },
    });
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "despesa.criar",
    entidade: "Despesa",
    entidadeId: despesa.id,
    descricao: `Despesa "${despesa.descricao}" cadastrada (${formatoMoeda.format(Number(despesa.valor))})`,
  });

  revalidarFinanceiro();
  return { ok: true, mensagem: "Despesa cadastrada com sucesso!" };
}

export async function editarDespesa(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }
  const despesaId = String(formData.get("despesaId"));

  const despesa = await prisma.despesa.findFirst({
    where: { id: despesaId, graficaId: usuario.graficaId },
  });
  if (!despesa) {
    return { ok: false, mensagem: "Despesa não encontrada." };
  }

  const parsed = despesaSchema.safeParse({
    descricao: formData.get("descricao"),
    categoria: formData.get("categoria") ?? undefined,
    valor: formData.get("valor"),
    vencimento: formData.get("vencimento"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const recorrente = formData.get("recorrente") === "on";

  await prisma.despesa.update({
    where: { id: despesaId },
    data: {
      ...parsed.data,
      recorrente,
      // Liga recorrência numa despesa que ainda não tinha série: essa
      // ocorrência vira o início. Já tinha série (recorrente antes ou
      // desligando agora): mantém o serieRecorrenciaId como estava — ver
      // comentário no schema sobre só a ocorrência mais recente decidir.
      serieRecorrenciaId: recorrente && !despesa.serieRecorrenciaId ? despesaId : despesa.serieRecorrenciaId,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "despesa.editar",
    entidade: "Despesa",
    entidadeId: despesaId,
    descricao: `Despesa "${parsed.data.descricao}" editada (agora ${formatoMoeda.format(Number(parsed.data.valor))})`,
  });

  revalidarFinanceiro(despesaId);
  return { ok: true, mensagem: "Despesa atualizada com sucesso!" };
}

export async function excluirDespesa(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }
  const despesaId = String(formData.get("despesaId"));

  const despesa = await prisma.despesa.findFirst({
    where: { id: despesaId, graficaId: usuario.graficaId },
  });
  if (!despesa) {
    return { ok: false, mensagem: "Despesa não encontrada." };
  }

  // Registrado ANTES do delete: entidadeId não é FK de propósito (ver
  // comentário em LogAuditoria no schema), então o log sobrevive ao registro
  // que ele descreve — mas os dados (descrição/valor) só existem até aqui.
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "despesa.excluir",
    entidade: "Despesa",
    entidadeId: despesaId,
    descricao: `Despesa "${despesa.descricao}" excluída (${formatoMoeda.format(Number(despesa.valor))})`,
  });

  // Hard delete direto: nada tem FK pra Despesa (diferente de Prensa, que
  // bloqueia por causa de ItemGrafica.prensaId).
  await prisma.despesa.delete({ where: { id: despesaId } });

  revalidarFinanceiro();
  redirect("/financeiro");
}

// status/pagoEm nunca são campos de formulário genérico — só essa action
// (e marcarComoPendente, o desfazer) mexem neles, garantindo que nunca
// existe uma despesa "paga" sem data de pagamento ou vice-versa.
export async function marcarComoPaga(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }

  const parsed = marcarComoPagaSchema.safeParse({
    despesaId: formData.get("despesaId"),
    formaPagamento: formData.get("formaPagamento"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { despesaId, formaPagamento } = parsed.data;

  const despesa = await prisma.despesa.findFirst({
    where: { id: despesaId, graficaId: usuario.graficaId },
  });
  if (!despesa) {
    return { ok: false, mensagem: "Despesa não encontrada." };
  }

  await prisma.despesa.update({
    where: { id: despesaId },
    data: { status: "PAGA", pagoEm: new Date(), formaPagamento },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "despesa.marcar_paga",
    entidade: "Despesa",
    entidadeId: despesaId,
    descricao: `Despesa "${despesa.descricao}" marcada como paga (${formatoMoeda.format(Number(despesa.valor))})`,
  });

  revalidarFinanceiro(despesaId);
  return { ok: true, mensagem: "Despesa marcada como paga." };
}

export async function marcarComoPendente(
  _estadoAnterior: DespesaResult | null,
  formData: FormData
): Promise<DespesaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "FINANCEIRO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o financeiro." };
  }
  const despesaId = String(formData.get("despesaId"));

  const despesa = await prisma.despesa.findFirst({
    where: { id: despesaId, graficaId: usuario.graficaId },
  });
  if (!despesa) {
    return { ok: false, mensagem: "Despesa não encontrada." };
  }

  await prisma.despesa.update({
    where: { id: despesaId },
    data: { status: "PENDENTE", pagoEm: null, formaPagamento: null },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "despesa.marcar_pendente",
    entidade: "Despesa",
    entidadeId: despesaId,
    descricao: `Despesa "${despesa.descricao}" marcada como pendente novamente`,
  });

  revalidarFinanceiro(despesaId);
  return { ok: true, mensagem: "Despesa marcada como pendente novamente." };
}
