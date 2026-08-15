"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";

export type SalvarFornecedorResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_NOME_VAZIO = "Informe um nome para o fornecedor.";
const MENSAGEM_NOME_DUPLICADO = "Já existe um fornecedor com esse nome.";

// Cria um novo fornecedor pra gráfica — cadastro deliberadamente pequeno
// (só "quem vendeu este material"), sem workflow de cotação/aprovação de
// compra (ver comentário do model Fornecedor no schema).
export async function criarFornecedor(
  _estadoAnterior: SalvarFornecedorResult | null,
  formData: FormData
): Promise<SalvarFornecedorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }
  const contato = String(formData.get("contato") ?? "").trim();

  let novoFornecedor: { id: string };
  try {
    novoFornecedor = await prisma.fornecedor.create({
      data: { graficaId: usuario.graficaId, nome, contato: contato || null },
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
    acao: "configuracoes.criar_fornecedor",
    entidade: "Fornecedor",
    entidadeId: novoFornecedor.id,
    descricao: `Fornecedor "${nome}" criado`,
  });

  revalidatePath("/configuracoes/fornecedores");
  redirect(`/configuracoes/fornecedores/${novoFornecedor.id}`);
}

// Edita nome/contato de um fornecedor já existente — nunca mexe em `ativo`,
// ver alternarAtivoFornecedor pra isso.
export async function editarFornecedor(
  _estadoAnterior: SalvarFornecedorResult | null,
  formData: FormData
): Promise<SalvarFornecedorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const fornecedorId = String(formData.get("fornecedorId"));
  const fornecedor = await prisma.fornecedor.findFirst({
    where: { id: fornecedorId, graficaId: usuario.graficaId },
  });
  if (!fornecedor) {
    return { ok: false, mensagem: "Fornecedor não encontrado." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }
  const contato = String(formData.get("contato") ?? "").trim();

  try {
    await prisma.fornecedor.update({
      where: { id: fornecedorId },
      data: { nome, contato: contato || null },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  const antesTextos: string[] = [];
  const depoisTextos: string[] = [];
  if (fornecedor.nome !== nome) {
    antesTextos.push(`Nome: ${fornecedor.nome}`);
    depoisTextos.push(`Nome: ${nome}`);
  }
  if ((fornecedor.contato ?? "") !== contato) {
    antesTextos.push(`Contato: ${fornecedor.contato ?? "—"}`);
    depoisTextos.push(`Contato: ${contato || "—"}`);
  }
  if (antesTextos.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.editar_fornecedor",
      entidade: "Fornecedor",
      entidadeId: fornecedorId,
      descricao: `Fornecedor "${fornecedor.nome}" atualizado`,
      valorAnterior: antesTextos.join(", "),
      valorNovo: depoisTextos.join(", "),
    });
  }

  revalidatePath(`/configuracoes/fornecedores/${fornecedorId}`);
  revalidatePath("/configuracoes/fornecedores");
  return { ok: true, mensagem: "Fornecedor atualizado com sucesso!" };
}

// Alterna ativo/inativo — é o equivalente de "remover" desta tela. NUNCA um
// delete físico: MovimentacaoEstoque.fornecedorId é onDelete SetNull no
// schema, então mesmo apagando de verdade o histórico de compra continuaria
// íntegro (só perderia o nome do fornecedor) — mas o princípio aqui é o
// mesmo de CategoriaCusto.ativa: um fornecedor referenciado em histórico de
// compra não some, só sai da lista de seleção pra novas compras.
export async function alternarAtivoFornecedor(
  _estadoAnterior: SalvarFornecedorResult | null,
  formData: FormData
): Promise<SalvarFornecedorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const fornecedorId = String(formData.get("fornecedorId"));
  const fornecedor = await prisma.fornecedor.findFirst({
    where: { id: fornecedorId, graficaId: usuario.graficaId },
  });
  if (!fornecedor) {
    return { ok: false, mensagem: "Fornecedor não encontrado." };
  }

  await prisma.fornecedor.update({
    where: { id: fornecedorId },
    data: { ativo: !fornecedor.ativo },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: fornecedor.ativo ? "configuracoes.desativar_fornecedor" : "configuracoes.ativar_fornecedor",
    entidade: "Fornecedor",
    entidadeId: fornecedorId,
    descricao: `Fornecedor "${fornecedor.nome}" ${fornecedor.ativo ? "desativado" : "ativado"}`,
  });

  revalidatePath(`/configuracoes/fornecedores/${fornecedorId}`);
  revalidatePath("/configuracoes/fornecedores");
  return {
    ok: true,
    mensagem: fornecedor.ativo ? "Fornecedor desativado." : "Fornecedor ativado.",
  };
}
