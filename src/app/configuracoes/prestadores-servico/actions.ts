"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { TipoPrestadorServico } from "@/generated/prisma/enums";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";
import {
  ORDEM_TIPO_PRESTADOR_SERVICO,
  rotuloTipoPrestadorServico,
} from "@/lib/tipos-prestador-servico";

export type SalvarPrestadorServicoResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_NOME_VAZIO = "Informe um nome para o prestador de serviço.";
const MENSAGEM_NOME_DUPLICADO = "Já existe um prestador de serviço com esse nome.";

// Mesmo padrão do resto do schema (TipoFerramental, CategoriaEquipamento
// etc.): tipo vem de uma lista fechada com OUTRO de escape — tipoOutro só é
// obrigatório nesse caso.
function validarTipo(
  formData: FormData
):
  | { ok: true; tipo: TipoPrestadorServico; tipoOutro: string | null }
  | { ok: false; mensagem: string } {
  const tipo = String(formData.get("tipo") ?? "");
  if (!ORDEM_TIPO_PRESTADOR_SERVICO.includes(tipo as TipoPrestadorServico)) {
    return { ok: false, mensagem: "Selecione um tipo de prestador de serviço." };
  }
  if (tipo === "OUTRO") {
    const tipoOutro = String(formData.get("tipoOutro") ?? "").trim();
    if (!tipoOutro) {
      return { ok: false, mensagem: 'Descreva o tipo quando escolher "Outro".' };
    }
    return { ok: true, tipo: "OUTRO", tipoOutro };
  }
  return { ok: true, tipo: tipo as TipoPrestadorServico, tipoOutro: null };
}

function campoTextoOuNull(formData: FormData, nome: string): string | null {
  const valor = String(formData.get(nome) ?? "").trim();
  return valor || null;
}

// Cria um novo prestador de serviço pra gráfica — cadastro deliberadamente
// pequeno (nome + tipo + contato), mesmo tamanho de Fornecedor mas pro lado
// de serviço recorrente (acabamento terceirizado, logística, design), não
// compra de matéria-prima (ver comentário do model no schema).
export async function criarPrestadorServico(
  _estadoAnterior: SalvarPrestadorServicoResult | null,
  formData: FormData
): Promise<SalvarPrestadorServicoResult> {
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

  const documento = campoTextoOuNull(formData, "documento");
  const telefone = campoTextoOuNull(formData, "telefone");
  const email = campoTextoOuNull(formData, "email");
  const observacoes = campoTextoOuNull(formData, "observacoes");

  let novoPrestador: { id: string };
  try {
    novoPrestador = await prisma.prestadorServico.create({
      data: {
        graficaId: usuario.graficaId,
        nome,
        tipo: validacaoTipo.tipo,
        tipoOutro: validacaoTipo.tipoOutro,
        documento,
        telefone,
        email,
        observacoes,
      },
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
    acao: "configuracoes.criar_prestador_servico",
    entidade: "PrestadorServico",
    entidadeId: novoPrestador.id,
    descricao: `Prestador de serviço "${nome}" (${rotuloTipoPrestadorServico(validacaoTipo.tipo, validacaoTipo.tipoOutro)}) criado`,
  });

  revalidatePath("/configuracoes/prestadores-servico");
  redirect(`/configuracoes/prestadores-servico/${novoPrestador.id}`);
}

// Edita os dados de um prestador de serviço já existente — nunca mexe em
// `ativo`, ver alternarAtivoPrestadorServico pra isso.
export async function editarPrestadorServico(
  _estadoAnterior: SalvarPrestadorServicoResult | null,
  formData: FormData
): Promise<SalvarPrestadorServicoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const prestadorServicoId = String(formData.get("prestadorServicoId"));
  const prestador = await prisma.prestadorServico.findFirst({
    where: { id: prestadorServicoId, graficaId: usuario.graficaId },
  });
  if (!prestador) {
    return { ok: false, mensagem: "Prestador de serviço não encontrado." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }

  const validacaoTipo = validarTipo(formData);
  if (!validacaoTipo.ok) {
    return validacaoTipo;
  }

  const documento = campoTextoOuNull(formData, "documento");
  const telefone = campoTextoOuNull(formData, "telefone");
  const email = campoTextoOuNull(formData, "email");
  const observacoes = campoTextoOuNull(formData, "observacoes");

  try {
    await prisma.prestadorServico.update({
      where: { id: prestadorServicoId },
      data: {
        nome,
        tipo: validacaoTipo.tipo,
        tipoOutro: validacaoTipo.tipoOutro,
        documento,
        telefone,
        email,
        observacoes,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  const diff = criarDiffCampos();
  diff.campo("Nome", prestador.nome, nome);
  diff.campo(
    "Tipo",
    rotuloTipoPrestadorServico(prestador.tipo, prestador.tipoOutro),
    rotuloTipoPrestadorServico(validacaoTipo.tipo, validacaoTipo.tipoOutro)
  );
  diff.campo("Documento", prestador.documento, documento);
  diff.campo("Telefone", prestador.telefone, telefone);
  diff.campo("E-mail", prestador.email, email);
  diff.campo("Observações", prestador.observacoes, observacoes);
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.editar_prestador_servico",
      entidade: "PrestadorServico",
      entidadeId: prestadorServicoId,
      descricao: `Prestador de serviço "${prestador.nome}" atualizado`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/prestadores-servico/${prestadorServicoId}`);
  revalidatePath("/configuracoes/prestadores-servico");
  return { ok: true, mensagem: "Prestador de serviço atualizado com sucesso!" };
}

// Alterna ativo/inativo — é o equivalente de "remover" desta tela. NUNCA um
// delete físico: mesmo princípio de alternarAtivoFornecedor — um prestador
// não deve sumir do sistema (histórico/auditoria referenciam pelo id), só
// sair da lista de seleção pra vínculos novos. Nesta rodada nenhuma outra
// tabela ainda tem FK pra PrestadorServico (ver comentário do model no
// schema — o vínculo com Despesa ficou pra uma rodada futura), então
// desativar aqui não tem nenhum efeito em cascata a considerar por ora.
export async function alternarAtivoPrestadorServico(
  _estadoAnterior: SalvarPrestadorServicoResult | null,
  formData: FormData
): Promise<SalvarPrestadorServicoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const prestadorServicoId = String(formData.get("prestadorServicoId"));
  const prestador = await prisma.prestadorServico.findFirst({
    where: { id: prestadorServicoId, graficaId: usuario.graficaId },
  });
  if (!prestador) {
    return { ok: false, mensagem: "Prestador de serviço não encontrado." };
  }

  await prisma.prestadorServico.update({
    where: { id: prestadorServicoId },
    data: { ativo: !prestador.ativo },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: prestador.ativo
      ? "configuracoes.desativar_prestador_servico"
      : "configuracoes.ativar_prestador_servico",
    entidade: "PrestadorServico",
    entidadeId: prestadorServicoId,
    descricao: `Prestador de serviço "${prestador.nome}" ${prestador.ativo ? "desativado" : "ativado"}`,
  });

  revalidatePath(`/configuracoes/prestadores-servico/${prestadorServicoId}`);
  revalidatePath("/configuracoes/prestadores-servico");
  return {
    ok: true,
    mensagem: prestador.ativo ? "Prestador de serviço desativado." : "Prestador de serviço ativado.",
  };
}
