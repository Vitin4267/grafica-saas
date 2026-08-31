"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { ORDEM_CATEGORIA_EQUIPAMENTO, ROTULO_CATEGORIA_EQUIPAMENTO } from "@/lib/tipos-equipamento";
import type { CategoriaEquipamento } from "@/generated/prisma/enums";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";

export type SalvarEquipamentoResult = { ok: boolean; mensagem: string };

// Rótulo legível pra auditoria — cai pra "categoriaOutro" quando a categoria
// é o escape hatch OUTRO (mesmo padrão de exibição da tela).
function rotuloCategoria(categoria: CategoriaEquipamento, categoriaOutro: string | null): string {
  return categoria === "OUTRO" ? categoriaOutro ?? "Outro" : ROTULO_CATEGORIA_EQUIPAMENTO[categoria];
}

// Mesmo padrão do resto do schema (UnidadeMedida, MaterialSubstrato etc.):
// categoria vem de uma lista fechada com OUTRO de escape — categoriaOutro só
// é obrigatório nesse caso, nunca trava um equipamento real fora da lista.
function validarCategoria(
  formData: FormData
): { ok: true; categoria: CategoriaEquipamento; categoriaOutro: string | null } | { ok: false; mensagem: string } {
  const categoria = String(formData.get("categoria") ?? "");
  if (!ORDEM_CATEGORIA_EQUIPAMENTO.includes(categoria as CategoriaEquipamento)) {
    return { ok: false, mensagem: "Selecione uma categoria." };
  }
  if (categoria === "OUTRO") {
    const categoriaOutro = String(formData.get("categoriaOutro") ?? "").trim();
    if (!categoriaOutro) {
      return { ok: false, mensagem: 'Descreva a categoria quando escolher "Outro".' };
    }
    return { ok: true, categoria: "OUTRO", categoriaOutro };
  }
  return { ok: true, categoria: categoria as CategoriaEquipamento, categoriaOutro: null };
}

// Achado A3 da Parte 7 da auditoria de abrangência (impressora de grande
// formato sem largura cadastrável) — campo numérico opcional, mesmo padrão
// de validação de "string vazia vira null, valor inválido é rejeitado com
// mensagem" já usado pra campos numéricos opcionais de formulário no resto
// do projeto (ver Cliente.prazoPagamentoPadraoDias em
// src/app/clientes/actions.ts). Não é específico de categoria — qualquer
// Equipamento pode ter largura máxima, não só IMPRESSORA_GRANDE_FORMATO.
function validarLarguraMaximaMm(
  formData: FormData
): { ok: true; valor: number | null } | { ok: false; mensagem: string } {
  const bruto = formData.get("larguraMaximaMm");
  if (typeof bruto !== "string" || bruto.trim() === "") {
    return { ok: true, valor: null };
  }
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor <= 0) {
    return { ok: false, mensagem: "Largura máxima inválida — use um número inteiro positivo de milímetros." };
  }
  return { ok: true, valor };
}

export async function criarEquipamento(
  _estadoAnterior: SalvarEquipamentoResult | null,
  formData: FormData
): Promise<SalvarEquipamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para o equipamento." };
  }

  const validacaoCategoria = validarCategoria(formData);
  if (!validacaoCategoria.ok) {
    return validacaoCategoria;
  }

  const validacaoLarguraMaximaMm = validarLarguraMaximaMm(formData);
  if (!validacaoLarguraMaximaMm.ok) {
    return validacaoLarguraMaximaMm;
  }

  const marca = String(formData.get("marca") ?? "").trim() || null;
  const modelo = String(formData.get("modelo") ?? "").trim() || null;
  const tecnologiaImpressao = String(formData.get("tecnologiaImpressao") ?? "").trim() || null;

  let novoEquipamento: { id: string };
  try {
    novoEquipamento = await prisma.equipamento.create({
      data: {
        graficaId: usuario.graficaId,
        nome,
        categoria: validacaoCategoria.categoria,
        categoriaOutro: validacaoCategoria.categoriaOutro,
        marca,
        modelo,
        larguraMaximaMm: validacaoLarguraMaximaMm.valor,
        tecnologiaImpressao,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um equipamento com esse nome." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_equipamento",
    entidade: "Equipamento",
    entidadeId: novoEquipamento.id,
    descricao: `Equipamento "${nome}" (${rotuloCategoria(validacaoCategoria.categoria, validacaoCategoria.categoriaOutro)}) criado`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect(`/configuracoes/maquinas/equipamentos/${novoEquipamento.id}`);
}

export async function salvarEquipamento(
  _estadoAnterior: SalvarEquipamentoResult | null,
  formData: FormData
): Promise<SalvarEquipamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const equipamentoId = String(formData.get("equipamentoId"));

  const equipamento = await prisma.equipamento.findFirst({
    where: { id: equipamentoId, graficaId: usuario.graficaId },
  });
  if (!equipamento) {
    return { ok: false, mensagem: "Equipamento não encontrado." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para o equipamento." };
  }
  const ativo = formData.get("ativo") === "on";

  const validacaoCategoria = validarCategoria(formData);
  if (!validacaoCategoria.ok) {
    return validacaoCategoria;
  }

  const validacaoLarguraMaximaMm = validarLarguraMaximaMm(formData);
  if (!validacaoLarguraMaximaMm.ok) {
    return validacaoLarguraMaximaMm;
  }

  const marca = String(formData.get("marca") ?? "").trim() || null;
  const modelo = String(formData.get("modelo") ?? "").trim() || null;
  const tecnologiaImpressao = String(formData.get("tecnologiaImpressao") ?? "").trim() || null;

  try {
    await prisma.equipamento.update({
      where: { id: equipamentoId },
      data: {
        nome,
        ativo,
        categoria: validacaoCategoria.categoria,
        categoriaOutro: validacaoCategoria.categoriaOutro,
        marca,
        modelo,
        larguraMaximaMm: validacaoLarguraMaximaMm.valor,
        tecnologiaImpressao,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um equipamento com esse nome." };
    }
    throw erro;
  }

  const diff = criarDiffCampos();
  diff.campo("Nome", equipamento.nome, nome);
  diff.campo("Ativo", equipamento.ativo, ativo);
  diff.campo(
    "Categoria",
    rotuloCategoria(equipamento.categoria, equipamento.categoriaOutro),
    rotuloCategoria(validacaoCategoria.categoria, validacaoCategoria.categoriaOutro)
  );
  diff.campo("Marca", equipamento.marca, marca);
  diff.campo("Modelo", equipamento.modelo, modelo);
  diff.campo("Largura máxima (mm)", equipamento.larguraMaximaMm, validacaoLarguraMaximaMm.valor);
  diff.campo("Tecnologia de impressão", equipamento.tecnologiaImpressao, tecnologiaImpressao);
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_equipamento",
      entidade: "Equipamento",
      entidadeId: equipamentoId,
      descricao: `Equipamento "${equipamento.nome}" atualizado`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/maquinas/equipamentos/${equipamentoId}`);
  revalidatePath("/configuracoes/maquinas");
  return { ok: true, mensagem: "Equipamento salvo com sucesso!" };
}

// Sem verificação de FK em uso: diferente de Prensa/MaquinaFlexografia,
// nenhum ItemGrafica referencia Equipamento (não tem motor de custo próprio,
// ver comentário no schema) — só RegistroManutencao aponta pra cá, e é
// onDelete:Cascade de propósito (mesmo princípio já aplicado às outras duas
// máquinas: histórico de manutenção sem o equipamento que ele descreve não
// tem valor).
export async function excluirEquipamento(
  _estadoAnterior: SalvarEquipamentoResult | null,
  formData: FormData
): Promise<SalvarEquipamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const equipamentoId = String(formData.get("equipamentoId"));

  // Busca o nome ANTES de apagar só pra deixar a descrição do log legível —
  // a exclusão em si continua sendo o deleteMany filtrado por graficaId
  // (TOCTOU-safe), não um findFirst + delete.
  const equipamentoParaLog = await prisma.equipamento.findFirst({
    where: { id: equipamentoId, graficaId: usuario.graficaId },
    select: { nome: true },
  });

  const resultado = await prisma.equipamento.deleteMany({
    where: { id: equipamentoId, graficaId: usuario.graficaId },
  });
  if (resultado.count === 0) {
    return { ok: false, mensagem: "Equipamento não encontrado." };
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.excluir_equipamento",
    entidade: "Equipamento",
    entidadeId: equipamentoId,
    descricao: `Equipamento "${equipamentoParaLog?.nome ?? equipamentoId}" excluído`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect("/configuracoes/maquinas");
}
