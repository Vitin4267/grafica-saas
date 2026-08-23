"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { ehViolacaoDeChaveEstrangeira } from "@/lib/prisma-conflito";

export type SalvarImpressoraDigitalResult = { ok: boolean; mensagem: string };

export async function criarImpressoraDigital(
  _estadoAnterior: SalvarImpressoraDigitalResult | null,
  formData: FormData
): Promise<SalvarImpressoraDigitalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a impressora." };
  }

  let novaImpressora: { id: string };
  try {
    novaImpressora = await prisma.impressoraDigital.create({
      data: { graficaId: usuario.graficaId, nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma impressora com esse nome." };
    }
    throw erro;
  }

  revalidatePath("/configuracoes/maquinas");
  redirect(`/configuracoes/maquinas/impressao-digital/${novaImpressora.id}`);
}

export async function salvarImpressoraDigital(
  _estadoAnterior: SalvarImpressoraDigitalResult | null,
  formData: FormData
): Promise<SalvarImpressoraDigitalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const impressoraId = String(formData.get("impressoraId"));

  const impressora = await prisma.impressoraDigital.findFirst({
    where: { id: impressoraId, graficaId: usuario.graficaId },
  });
  if (!impressora) {
    return { ok: false, mensagem: "Impressora não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a impressora." };
  }
  const ativa = formData.get("ativa") === "on";

  const custoPorClique = Number(formData.get("custoPorClique"));
  if (!Number.isFinite(custoPorClique) || custoPorClique < 0) {
    return { ok: false, mensagem: 'Valor inválido em "Custo por clique".' };
  }

  try {
    await prisma.impressoraDigital.update({
      where: { id: impressoraId },
      data: { nome, ativa, custoPorClique },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma impressora com esse nome." };
    }
    throw erro;
  }

  revalidatePath(`/configuracoes/maquinas/impressao-digital/${impressoraId}`);
  revalidatePath("/configuracoes/maquinas");
  return { ok: true, mensagem: "Impressora salva com sucesso!" };
}

export async function excluirImpressoraDigital(
  _estadoAnterior: SalvarImpressoraDigitalResult | null,
  formData: FormData
): Promise<SalvarImpressoraDigitalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const impressoraId = String(formData.get("impressoraId"));

  const impressora = await prisma.impressoraDigital.findFirst({
    where: { id: impressoraId, graficaId: usuario.graficaId },
  });
  if (!impressora) {
    return { ok: false, mensagem: "Impressora não encontrada." };
  }

  try {
    await prisma.impressoraDigital.delete({ where: { id: impressoraId } });
  } catch (erro) {
    if (ehViolacaoDeChaveEstrangeira(erro)) {
      return {
        ok: false,
        mensagem:
          "Esta impressora está em uso por produtos do catálogo — troque a impressora desses produtos antes de excluir.",
      };
    }
    throw erro;
  }

  revalidatePath("/configuracoes/maquinas");
  redirect("/configuracoes/maquinas");
}
