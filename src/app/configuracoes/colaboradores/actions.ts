"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { TipoColaborador } from "@/generated/prisma/enums";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";
import { ORDEM_TIPO_COLABORADOR, rotuloTipoColaborador } from "@/lib/tipos-colaborador";

export type SalvarColaboradorResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_NOME_VAZIO = "Informe um nome para o colaborador.";

// Achado D1 da auditoria de abrangência (Parte 4/Qualidade-pessoas) — mesmo
// padrão do resto do schema (TipoPrestadorServico, TipoFerramental etc.):
// tipo vem de uma lista fechada com OUTRO de escape — tipoOutro só é
// obrigatório nesse caso.
function validarTipo(
  formData: FormData
): { ok: true; tipo: TipoColaborador; tipoOutro: string | null } | { ok: false; mensagem: string } {
  const tipo = String(formData.get("tipo") ?? "");
  if (!ORDEM_TIPO_COLABORADOR.includes(tipo as TipoColaborador)) {
    return { ok: false, mensagem: "Selecione um tipo de colaborador." };
  }
  if (tipo === "OUTRO") {
    const tipoOutro = String(formData.get("tipoOutro") ?? "").trim();
    if (!tipoOutro) {
      return { ok: false, mensagem: 'Descreva o tipo quando escolher "Outro".' };
    }
    return { ok: true, tipo: "OUTRO", tipoOutro };
  }
  return { ok: true, tipo: tipo as TipoColaborador, tipoOutro: null };
}

function campoTextoOuNull(formData: FormData, nome: string): string | null {
  const valor = String(formData.get(nome) ?? "").trim();
  return valor || null;
}

// Cria um novo colaborador (pessoa sem login) pra gráfica — cadastro
// deliberadamente pequeno (nome + tipo + telefone), NUNCA cria Usuario nem
// toca em auth (ver comentário do model no schema).
export async function criarColaborador(
  _estadoAnterior: SalvarColaboradorResult | null,
  formData: FormData
): Promise<SalvarColaboradorResult> {
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

  const validacaoTipo = validarTipo(formData);
  if (!validacaoTipo.ok) {
    return validacaoTipo;
  }

  const telefone = campoTextoOuNull(formData, "telefone");

  const novoColaborador = await prisma.colaborador.create({
    data: {
      graficaId: usuario.graficaId,
      nome,
      tipo: validacaoTipo.tipo,
      tipoOutro: validacaoTipo.tipoOutro,
      telefone,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_colaborador",
    entidade: "Colaborador",
    entidadeId: novoColaborador.id,
    descricao: `Colaborador "${nome}" (${rotuloTipoColaborador(validacaoTipo.tipo, validacaoTipo.tipoOutro)}) criado`,
  });

  revalidatePath("/configuracoes/colaboradores");
  redirect(`/configuracoes/colaboradores/${novoColaborador.id}`);
}

// Edita os dados de um colaborador já existente — nunca mexe em `ativo`, ver
// alternarAtivoColaborador pra isso.
export async function editarColaborador(
  _estadoAnterior: SalvarColaboradorResult | null,
  formData: FormData
): Promise<SalvarColaboradorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const colaboradorId = String(formData.get("colaboradorId"));
  const colaborador = await prisma.colaborador.findFirst({
    where: { id: colaboradorId, graficaId: usuario.graficaId },
  });
  if (!colaborador) {
    return { ok: false, mensagem: "Colaborador não encontrado." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }

  const validacaoTipo = validarTipo(formData);
  if (!validacaoTipo.ok) {
    return validacaoTipo;
  }

  const telefone = campoTextoOuNull(formData, "telefone");

  await prisma.colaborador.update({
    where: { id: colaboradorId },
    data: {
      nome,
      tipo: validacaoTipo.tipo,
      tipoOutro: validacaoTipo.tipoOutro,
      telefone,
    },
  });

  const diff = criarDiffCampos();
  diff.campo("Nome", colaborador.nome, nome);
  diff.campo(
    "Tipo",
    rotuloTipoColaborador(colaborador.tipo, colaborador.tipoOutro),
    rotuloTipoColaborador(validacaoTipo.tipo, validacaoTipo.tipoOutro)
  );
  diff.campo("Telefone", colaborador.telefone, telefone);
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.editar_colaborador",
      entidade: "Colaborador",
      entidadeId: colaboradorId,
      descricao: `Colaborador "${colaborador.nome}" atualizado`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/colaboradores/${colaboradorId}`);
  revalidatePath("/configuracoes/colaboradores");
  return { ok: true, mensagem: "Colaborador atualizado com sucesso!" };
}

// Alterna ativo/inativo — é o equivalente de "remover" desta tela. NUNCA um
// delete físico: Entrega.motoristaColaboradorId é onDelete SetNull no
// schema, mesmo princípio de alternarAtivaTransportadora — um colaborador
// referenciado numa entrega não some, só sai da lista de seleção pra novo
// uso.
export async function alternarAtivoColaborador(
  _estadoAnterior: SalvarColaboradorResult | null,
  formData: FormData
): Promise<SalvarColaboradorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const colaboradorId = String(formData.get("colaboradorId"));
  const colaborador = await prisma.colaborador.findFirst({
    where: { id: colaboradorId, graficaId: usuario.graficaId },
  });
  if (!colaborador) {
    return { ok: false, mensagem: "Colaborador não encontrado." };
  }

  await prisma.colaborador.update({
    where: { id: colaboradorId },
    data: { ativo: !colaborador.ativo },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: colaborador.ativo
      ? "configuracoes.desativar_colaborador"
      : "configuracoes.ativar_colaborador",
    entidade: "Colaborador",
    entidadeId: colaboradorId,
    descricao: `Colaborador "${colaborador.nome}" ${colaborador.ativo ? "desativado" : "ativado"}`,
  });

  revalidatePath(`/configuracoes/colaboradores/${colaboradorId}`);
  revalidatePath("/configuracoes/colaboradores");
  return {
    ok: true,
    mensagem: colaborador.ativo ? "Colaborador desativado." : "Colaborador ativado.",
  };
}
