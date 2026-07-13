"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";

export type SalvarFilialResult = { ok: boolean; mensagem: string };

export async function criarFilial(
  _estadoAnterior: SalvarFilialResult | null,
  formData: FormData
): Promise<SalvarFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a filial." };
  }

  let novaFilial: { id: string };
  try {
    novaFilial = await prisma.filial.create({
      data: { graficaId: usuario.graficaId, nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma filial com esse nome." };
    }
    throw erro;
  }

  revalidatePath("/configuracoes/filiais");
  redirect(`/configuracoes/filiais/${novaFilial.id}`);
}

export async function salvarFilial(
  _estadoAnterior: SalvarFilialResult | null,
  formData: FormData
): Promise<SalvarFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const filialId = String(formData.get("filialId"));

  const filial = await prisma.filial.findFirst({
    where: { id: filialId, graficaId: usuario.graficaId },
  });
  if (!filial) {
    return { ok: false, mensagem: "Filial não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a filial." };
  }
  const enderecoBruto = String(formData.get("endereco") ?? "").trim();
  const endereco = enderecoBruto || null;
  const ativa = formData.get("ativa") === "on";

  try {
    await prisma.filial.update({
      where: { id: filialId },
      data: { nome, endereco, ativa },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma filial com esse nome." };
    }
    throw erro;
  }

  revalidatePath(`/configuracoes/filiais/${filialId}`);
  revalidatePath("/configuracoes/filiais");
  return { ok: true, mensagem: "Filial salva com sucesso!" };
}

// Sempre permitida (ao contrário de excluirPrensa) — Orcamento.filialId é
// onDelete: SetNull, então excluir uma filial só desvincula os orçamentos
// antigos dela (viram "sem filial"), nunca bloqueia por causa de histórico.
// Fechar uma filial não deveria travar limpeza de cadastro.
export async function excluirFilial(
  _estadoAnterior: SalvarFilialResult | null,
  formData: FormData
): Promise<SalvarFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const filialId = String(formData.get("filialId"));

  const filial = await prisma.filial.findFirst({
    where: { id: filialId, graficaId: usuario.graficaId },
  });
  if (!filial) {
    return { ok: false, mensagem: "Filial não encontrada." };
  }

  await prisma.filial.delete({ where: { id: filialId } });

  revalidatePath("/configuracoes/filiais");
  redirect("/configuracoes/filiais");
}
