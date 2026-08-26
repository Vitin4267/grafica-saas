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
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";

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

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_impressora_digital",
    entidade: "ImpressoraDigital",
    entidadeId: novaImpressora.id,
    descricao: `Impressora digital "${nome}" criada`,
  });

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

  const diff = criarDiffCampos();
  diff.campo("Nome", impressora.nome, nome);
  diff.campo("Ativa", impressora.ativa, ativa);
  diff.campo("Custo por clique", Number(impressora.custoPorClique), custoPorClique);
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_impressora_digital",
      entidade: "ImpressoraDigital",
      entidadeId: impressoraId,
      descricao: `Impressora digital "${impressora.nome}" atualizada`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
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

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.excluir_impressora_digital",
    entidade: "ImpressoraDigital",
    entidadeId: impressoraId,
    descricao: `Impressora digital "${impressora.nome}" excluída`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect("/configuracoes/maquinas");
}
