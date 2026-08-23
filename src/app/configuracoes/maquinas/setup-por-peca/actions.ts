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
import { ROTULO_PROCESSO_SETUP_POR_PECA } from "@/lib/tipos-equipamento";
import type { ProcessoSetupPorPeca } from "@/generated/prisma/enums";

export type SalvarMaquinaSetupPorPecaResult = { ok: boolean; mensagem: string };

const CAMPOS_DECIMAL = ["custoPorSetup", "custoPorPeca", "custoMinimo"] as const;

function validarTipoProcesso(
  formData: FormData
): { ok: true; tipoProcesso: ProcessoSetupPorPeca } | { ok: false; mensagem: string } {
  const tipoProcesso = String(formData.get("tipoProcesso") ?? "");
  if (!Object.keys(ROTULO_PROCESSO_SETUP_POR_PECA).includes(tipoProcesso)) {
    return { ok: false, mensagem: "Selecione um processo." };
  }
  return { ok: true, tipoProcesso: tipoProcesso as ProcessoSetupPorPeca };
}

export async function criarMaquinaSetupPorPeca(
  _estadoAnterior: SalvarMaquinaSetupPorPecaResult | null,
  formData: FormData
): Promise<SalvarMaquinaSetupPorPecaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a máquina." };
  }

  const validacaoTipo = validarTipoProcesso(formData);
  if (!validacaoTipo.ok) {
    return validacaoTipo;
  }

  let novaMaquina: { id: string };
  try {
    novaMaquina = await prisma.maquinaSetupPorPeca.create({
      data: { graficaId: usuario.graficaId, nome, tipoProcesso: validacaoTipo.tipoProcesso },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma máquina com esse nome." };
    }
    throw erro;
  }

  revalidatePath("/configuracoes/maquinas");
  redirect(`/configuracoes/maquinas/setup-por-peca/${novaMaquina.id}`);
}

export async function salvarMaquinaSetupPorPeca(
  _estadoAnterior: SalvarMaquinaSetupPorPecaResult | null,
  formData: FormData
): Promise<SalvarMaquinaSetupPorPecaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaSetupPorPeca.findFirst({
    where: { id: maquinaId, graficaId: usuario.graficaId },
  });
  if (!maquina) {
    return { ok: false, mensagem: "Máquina não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a máquina." };
  }
  const ativa = formData.get("ativa") === "on";

  const validacaoTipo = validarTipoProcesso(formData);
  if (!validacaoTipo.ok) {
    return validacaoTipo;
  }

  const dados: Record<string, number> = {};
  for (const campo of CAMPOS_DECIMAL) {
    const valor = Number(formData.get(campo));
    if (!Number.isFinite(valor) || valor < 0) {
      return { ok: false, mensagem: `Valor inválido em "${campo}".` };
    }
    dados[campo] = valor;
  }

  try {
    await prisma.maquinaSetupPorPeca.update({
      where: { id: maquinaId },
      data: { nome, ativa, tipoProcesso: validacaoTipo.tipoProcesso, ...dados },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma máquina com esse nome." };
    }
    throw erro;
  }

  revalidatePath(`/configuracoes/maquinas/setup-por-peca/${maquinaId}`);
  revalidatePath("/configuracoes/maquinas");
  return { ok: true, mensagem: "Máquina salva com sucesso!" };
}

export async function excluirMaquinaSetupPorPeca(
  _estadoAnterior: SalvarMaquinaSetupPorPecaResult | null,
  formData: FormData
): Promise<SalvarMaquinaSetupPorPecaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaSetupPorPeca.findFirst({
    where: { id: maquinaId, graficaId: usuario.graficaId },
  });
  if (!maquina) {
    return { ok: false, mensagem: "Máquina não encontrada." };
  }

  try {
    await prisma.maquinaSetupPorPeca.delete({ where: { id: maquinaId } });
  } catch (erro) {
    if (ehViolacaoDeChaveEstrangeira(erro)) {
      return {
        ok: false,
        mensagem:
          "Esta máquina está em uso por produtos do catálogo — troque a máquina desses produtos antes de excluir.",
      };
    }
    throw erro;
  }

  revalidatePath("/configuracoes/maquinas");
  redirect("/configuracoes/maquinas");
}
