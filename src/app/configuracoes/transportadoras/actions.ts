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

export type SalvarTransportadoraResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_NOME_VAZIO = "Informe um nome para a transportadora.";
const MENSAGEM_NOME_DUPLICADO = "Já existe uma transportadora com esse nome.";

// Achado F3 da auditoria de abrangência (Parte 7/Documento e transação) —
// mesmo padrão de criarFornecedor (configuracoes/fornecedores/actions.ts):
// cadastro deliberadamente pequeno, sem workflow de cotação de frete.
function campoTextoOuNull(formData: FormData, nome: string): string | null {
  const valor = String(formData.get(nome) ?? "").trim();
  return valor || null;
}

export async function criarTransportadora(
  _estadoAnterior: SalvarTransportadoraResult | null,
  formData: FormData
): Promise<SalvarTransportadoraResult> {
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
  const telefone = campoTextoOuNull(formData, "telefone");
  const email = campoTextoOuNull(formData, "email");

  let novaTransportadora: { id: string };
  try {
    novaTransportadora = await prisma.transportadora.create({
      data: { graficaId: usuario.graficaId, nome, telefone, email },
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
    acao: "configuracoes.criar_transportadora",
    entidade: "Transportadora",
    entidadeId: novaTransportadora.id,
    descricao: `Transportadora "${nome}" criada`,
  });

  revalidatePath("/configuracoes/transportadoras");
  redirect(`/configuracoes/transportadoras/${novaTransportadora.id}`);
}

// Edita nome/contato/documento/RNTRC de uma transportadora já existente —
// nunca mexe em `ativa`, ver alternarAtivaTransportadora pra isso.
export async function editarTransportadora(
  _estadoAnterior: SalvarTransportadoraResult | null,
  formData: FormData
): Promise<SalvarTransportadoraResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const transportadoraId = String(formData.get("transportadoraId"));
  const transportadora = await prisma.transportadora.findFirst({
    where: { id: transportadoraId, graficaId: usuario.graficaId },
  });
  if (!transportadora) {
    return { ok: false, mensagem: "Transportadora não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }
  const telefone = campoTextoOuNull(formData, "telefone");
  const email = campoTextoOuNull(formData, "email");
  const documento = campoTextoOuNull(formData, "documento");
  const rntrc = campoTextoOuNull(formData, "rntrc");

  try {
    await prisma.transportadora.update({
      where: { id: transportadoraId },
      data: { nome, telefone, email, documento, rntrc },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  const antesTextos: string[] = [];
  const depoisTextos: string[] = [];
  if (transportadora.nome !== nome) {
    antesTextos.push(`Nome: ${transportadora.nome}`);
    depoisTextos.push(`Nome: ${nome}`);
  }
  if ((transportadora.telefone ?? "") !== (telefone ?? "")) {
    antesTextos.push(`Telefone: ${transportadora.telefone ?? "—"}`);
    depoisTextos.push(`Telefone: ${telefone ?? "—"}`);
  }
  if (antesTextos.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.editar_transportadora",
      entidade: "Transportadora",
      entidadeId: transportadoraId,
      descricao: `Transportadora "${transportadora.nome}" atualizada`,
      valorAnterior: antesTextos.join(", "),
      valorNovo: depoisTextos.join(", "),
    });
  }

  revalidatePath(`/configuracoes/transportadoras/${transportadoraId}`);
  revalidatePath("/configuracoes/transportadoras");
  return { ok: true, mensagem: "Transportadora atualizada com sucesso!" };
}

// Alterna ativa/inativa — é o equivalente de "remover" desta tela. NUNCA um
// delete físico: Orcamento.transportadoraId e Entrega.transportadoraId são
// onDelete SetNull no schema, mesmo princípio de alternarAtivoFornecedor —
// uma transportadora referenciada em orçamento/entrega não some, só sai da
// lista de seleção pra novo uso.
export async function alternarAtivaTransportadora(
  _estadoAnterior: SalvarTransportadoraResult | null,
  formData: FormData
): Promise<SalvarTransportadoraResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const transportadoraId = String(formData.get("transportadoraId"));
  const transportadora = await prisma.transportadora.findFirst({
    where: { id: transportadoraId, graficaId: usuario.graficaId },
  });
  if (!transportadora) {
    return { ok: false, mensagem: "Transportadora não encontrada." };
  }

  await prisma.transportadora.update({
    where: { id: transportadoraId },
    data: { ativa: !transportadora.ativa },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: transportadora.ativa
      ? "configuracoes.desativar_transportadora"
      : "configuracoes.ativar_transportadora",
    entidade: "Transportadora",
    entidadeId: transportadoraId,
    descricao: `Transportadora "${transportadora.nome}" ${transportadora.ativa ? "desativada" : "ativada"}`,
  });

  revalidatePath(`/configuracoes/transportadoras/${transportadoraId}`);
  revalidatePath("/configuracoes/transportadoras");
  return {
    ok: true,
    mensagem: transportadora.ativa ? "Transportadora desativada." : "Transportadora ativada.",
  };
}
