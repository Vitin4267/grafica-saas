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

export type SalvarPrensaResult = { ok: boolean; mensagem: string };

const CAMPOS_DECIMAL = [
  "custoHoraMaq",
  "custoChapa",
  "tempoAcertoH",
  "custoMilheiroRod",
  "rodagemMinima",
  "perdaPercentPadrao",
] as const;

const CAMPOS_INTEIRO = ["torres", "folhasAcerto"] as const;

export async function criarPrensa(
  _estadoAnterior: SalvarPrensaResult | null,
  formData: FormData
): Promise<SalvarPrensaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a prensa." };
  }

  let novaPrensa: { id: string };
  try {
    novaPrensa = await prisma.prensa.create({
      data: { graficaId: usuario.graficaId, nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma prensa com esse nome." };
    }
    throw erro;
  }

  revalidatePath("/configuracoes/prensas");
  redirect(`/configuracoes/prensas/${novaPrensa.id}`);
}

export async function salvarPrensa(
  _estadoAnterior: SalvarPrensaResult | null,
  formData: FormData
): Promise<SalvarPrensaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const prensaId = String(formData.get("prensaId"));

  const prensa = await prisma.prensa.findFirst({
    where: { id: prensaId, graficaId: usuario.graficaId },
  });
  if (!prensa) {
    return { ok: false, mensagem: "Prensa não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a prensa." };
  }
  const ativa = formData.get("ativa") === "on";

  const dados: Record<string, number> = {};
  for (const campo of CAMPOS_DECIMAL) {
    const valor = Number(formData.get(campo));
    if (!Number.isFinite(valor) || valor < 0) {
      return { ok: false, mensagem: `Valor inválido em "${campo}".` };
    }
    dados[campo] = valor;
  }
  for (const campo of CAMPOS_INTEIRO) {
    const valor = Number(formData.get(campo));
    if (!Number.isInteger(valor) || valor < 1) {
      return { ok: false, mensagem: `Valor inválido em "${campo}" — deve ser um número inteiro maior que zero.` };
    }
    dados[campo] = valor;
  }

  try {
    await prisma.prensa.update({
      where: { id: prensaId },
      data: { nome, ativa, ...dados },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma prensa com esse nome." };
    }
    throw erro;
  }

  revalidatePath(`/configuracoes/prensas/${prensaId}`);
  revalidatePath("/configuracoes/prensas");
  return { ok: true, mensagem: "Prensa salva com sucesso!" };
}

export async function excluirPrensa(
  _estadoAnterior: SalvarPrensaResult | null,
  formData: FormData
): Promise<SalvarPrensaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const prensaId = String(formData.get("prensaId"));

  const prensa = await prisma.prensa.findFirst({
    where: { id: prensaId, graficaId: usuario.graficaId },
  });
  if (!prensa) {
    return { ok: false, mensagem: "Prensa não encontrada." };
  }

  try {
    await prisma.prensa.delete({ where: { id: prensaId } });
  } catch (erro) {
    if (ehViolacaoDeChaveEstrangeira(erro)) {
      return {
        ok: false,
        mensagem:
          "Esta prensa está em uso por produtos do catálogo — troque a prensa desses produtos antes de excluir.",
      };
    }
    throw erro;
  }

  revalidatePath("/configuracoes/prensas");
  redirect("/configuracoes/prensas");
}
