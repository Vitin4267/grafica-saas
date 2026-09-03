"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { exigirPapel, MODULOS_PERMISSAO } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";

// Achado A5 da auditoria de abrangência (Parte 6/Configurações,
// pesquisa-abrangencia-modulos.md, 2026-08-27) — CRUD de PerfilAcesso e das
// PermissaoPerfil dele. Gate por `exigirPapel(usuario, ["DONO"])`, NÃO por
// `podeEditarModulo(usuario, "CONFIGURACOES")` — mesmo precedente de
// src/app/usuarios/actions.ts (criarUsuario, salvarPermissoes etc.): quem
// define QUANTO acesso outra pessoa tem é sempre o DONO, mesmo que um ADMIN
// tenha acesso de edição a Configurações por outro motivo. Área sensível de
// autorização — nunca reduzir esse gate pra "podeEditarModulo".

export type SalvarPerfilAcessoResult = { ok: boolean; mensagem: string };

const MENSAGEM_NOME_DUPLICADO = "Já existe um perfil com esse nome.";

const nomePerfilSchema = z.string().trim().min(2, "Nome muito curto").max(80);

export async function criarPerfilAcesso(
  _estadoAnterior: SalvarPerfilAcessoResult | null,
  formData: FormData
): Promise<SalvarPerfilAcessoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const parsed = nomePerfilSchema.safeParse(formData.get("nome"));
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Nome inválido." };
  }
  const nome = parsed.data;

  let novoPerfil: { id: string };
  try {
    novoPerfil = await prisma.perfilAcesso.create({
      data: { graficaId: usuario.graficaId, nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_perfil_acesso",
    entidade: "PerfilAcesso",
    entidadeId: novoPerfil.id,
    descricao: `Perfil de acesso "${nome}" criado`,
  });

  revalidatePath("/configuracoes/perfis-acesso");
  redirect(`/configuracoes/perfis-acesso/${novoPerfil.id}`);
}

export type SalvarPermissoesPerfilResult = { ok: boolean; mensagem: string };

// Salva nome + grade de módulos numa única submissão — mesmo padrão de
// upsert-por-módulo de salvarPermissoes (src/app/usuarios/actions.ts), só
// que em PermissaoPerfil em vez de PermissaoUsuario. "podeVer" desmarcado
// também desmarca "podeEditar" (mesma regra, reforçada no server: nunca
// confiar que o client já aplicou a regra — ver GradePermissoesModulo, que
// desabilita o checkbox de editar no client, mas o form pode ser adulterado).
export async function editarPerfilAcesso(
  _estadoAnterior: SalvarPermissoesPerfilResult | null,
  formData: FormData
): Promise<SalvarPermissoesPerfilResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const perfilId = String(formData.get("perfilId") ?? "");
  const perfil = await prisma.perfilAcesso.findFirst({
    where: { id: perfilId, graficaId: usuario.graficaId },
  });
  if (!perfil) {
    return { ok: false, mensagem: "Perfil não encontrado." };
  }

  const parsedNome = nomePerfilSchema.safeParse(formData.get("nome"));
  if (!parsedNome.success) {
    return { ok: false, mensagem: parsedNome.error.issues[0]?.message ?? "Nome inválido." };
  }
  const nome = parsedNome.data;

  const permissoesAntes = await prisma.permissaoPerfil.findMany({ where: { perfilId } });
  const antesPorModulo = new Map(permissoesAntes.map((p) => [p.modulo, p]));

  const antesTextos: string[] = [];
  const depoisTextos: string[] = [];
  if (perfil.nome !== nome) {
    antesTextos.push(`Nome: ${perfil.nome}`);
    depoisTextos.push(`Nome: ${nome}`);
  }

  const operacoesPermissao = MODULOS_PERMISSAO.map(({ valor, rotulo }) => {
    const podeVer = formData.get(`ver_${valor}`) === "on";
    // Reforço no server: "editar" só vale se "ver" também estiver marcado,
    // mesmo que o form mande os dois de propósito.
    const podeEditar = podeVer && formData.get(`editar_${valor}`) === "on";
    const atual = antesPorModulo.get(valor);
    const verAntes = atual?.podeVer ?? false;
    const editarAntes = atual?.podeEditar ?? false;
    if (verAntes !== podeVer || editarAntes !== podeEditar) {
      antesTextos.push(`${rotulo} (ver: ${verAntes ? "sim" : "não"}, editar: ${editarAntes ? "sim" : "não"})`);
      depoisTextos.push(`${rotulo} (ver: ${podeVer ? "sim" : "não"}, editar: ${podeEditar ? "sim" : "não"})`);
    }
    return prisma.permissaoPerfil.upsert({
      where: { perfilId_modulo: { perfilId, modulo: valor } },
      create: { perfilId, modulo: valor, podeVer, podeEditar },
      update: { podeVer, podeEditar },
    });
  });

  try {
    await prisma.$transaction([
      prisma.perfilAcesso.update({ where: { id: perfilId }, data: { nome } }),
      ...operacoesPermissao,
    ]);
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  if (antesTextos.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.editar_perfil_acesso",
      entidade: "PerfilAcesso",
      entidadeId: perfilId,
      descricao: `Perfil de acesso "${perfil.nome}" atualizado`,
      valorAnterior: antesTextos.join("; "),
      valorNovo: depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/perfis-acesso/${perfilId}`);
  revalidatePath("/configuracoes/perfis-acesso");
  return { ok: true, mensagem: `Perfil "${nome}" salvo com sucesso!` };
}

export type ExcluirPerfilAcessoResult = { ok: boolean; mensagem: string };

// Hard delete (schema não tem campo de desativação pra PerfilAcesso, ver
// proposta original do achado) — mas bloqueado enquanto algum usuário ainda
// usa o perfil, pra nunca tirar acesso de alguém como efeito colateral
// silencioso de uma exclusão. onDelete: SetNull em Usuario.perfilAcessoId
// garante que, se algum dia isto for relaxado, a exclusão nunca apagaria
// usuário nem travaria no banco — mas a UI aqui é deliberadamente mais
// cautelosa que o schema permite.
export async function excluirPerfilAcesso(
  _estadoAnterior: ExcluirPerfilAcessoResult | null,
  formData: FormData
): Promise<ExcluirPerfilAcessoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const perfilId = String(formData.get("perfilId") ?? "");
  const perfil = await prisma.perfilAcesso.findFirst({
    where: { id: perfilId, graficaId: usuario.graficaId },
    include: { _count: { select: { usuarios: true } } },
  });
  if (!perfil) {
    return { ok: false, mensagem: "Perfil não encontrado." };
  }
  if (perfil._count.usuarios > 0) {
    return {
      ok: false,
      mensagem: `Este perfil está atribuído a ${perfil._count.usuarios} usuário(s). Troque o perfil deles em Usuários antes de excluir.`,
    };
  }

  await prisma.perfilAcesso.delete({ where: { id: perfilId } });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.excluir_perfil_acesso",
    entidade: "PerfilAcesso",
    entidadeId: perfilId,
    descricao: `Perfil de acesso "${perfil.nome}" excluído`,
  });

  revalidatePath("/configuracoes/perfis-acesso");
  redirect("/configuracoes/perfis-acesso");
}
