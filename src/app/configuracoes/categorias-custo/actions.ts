"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";

export type SalvarCategoriaCustoResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_NOME_VAZIO = "Informe um nome para a categoria.";
const MENSAGEM_NOME_DUPLICADO = "Já existe uma categoria com esse nome.";

// Cria uma nova categoria de custo pra gráfica, sempre no fim da ordem
// atual — a gráfica pode reordenar depois (ver reordenarCategoriasCusto).
export async function criarCategoriaCusto(
  _estadoAnterior: SalvarCategoriaCustoResult | null,
  formData: FormData
): Promise<SalvarCategoriaCustoResult> {
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

  const totalAtual = await prisma.categoriaCusto.count({
    where: { graficaId: usuario.graficaId },
  });

  let novaCategoria: { id: string };
  try {
    novaCategoria = await prisma.categoriaCusto.create({
      data: { graficaId: usuario.graficaId, nome, ordem: totalAtual },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  revalidatePath("/configuracoes/categorias-custo");
  redirect(`/configuracoes/categorias-custo/${novaCategoria.id}`);
}

// Renomeia uma categoria já existente — nunca mexe em `ativa`/`ordem`, ver
// alternarAtivaCategoriaCusto/reordenarCategoriasCusto pra isso.
export async function renomearCategoriaCusto(
  _estadoAnterior: SalvarCategoriaCustoResult | null,
  formData: FormData
): Promise<SalvarCategoriaCustoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const categoriaId = String(formData.get("categoriaId"));
  const categoria = await prisma.categoriaCusto.findFirst({
    where: { id: categoriaId, graficaId: usuario.graficaId },
  });
  if (!categoria) {
    return { ok: false, mensagem: "Categoria não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }

  try {
    await prisma.categoriaCusto.update({
      where: { id: categoriaId },
      data: { nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  revalidatePath(`/configuracoes/categorias-custo/${categoriaId}`);
  revalidatePath("/configuracoes/categorias-custo");
  return { ok: true, mensagem: "Categoria renomeada com sucesso!" };
}

// Alterna ativa/inativa — é o equivalente de "remover" desta tela. NUNCA um
// delete físico: CustoPedido.categoriaCustoId é onDelete Restrict no schema
// (o banco já impede apagar uma categoria referenciada por um lançamento de
// custo), e mesmo categorias nunca usadas continuam preservando o histórico
// de "essa gráfica um dia teve essa categoria configurada assim".
export async function alternarAtivaCategoriaCusto(
  _estadoAnterior: SalvarCategoriaCustoResult | null,
  formData: FormData
): Promise<SalvarCategoriaCustoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const categoriaId = String(formData.get("categoriaId"));
  const categoria = await prisma.categoriaCusto.findFirst({
    where: { id: categoriaId, graficaId: usuario.graficaId },
  });
  if (!categoria) {
    return { ok: false, mensagem: "Categoria não encontrada." };
  }

  await prisma.categoriaCusto.update({
    where: { id: categoriaId },
    data: { ativa: !categoria.ativa },
  });

  revalidatePath(`/configuracoes/categorias-custo/${categoriaId}`);
  revalidatePath("/configuracoes/categorias-custo");
  return {
    ok: true,
    mensagem: categoria.ativa ? "Categoria desativada." : "Categoria ativada.",
  };
}

// Reordenação simples (sem drag-and-drop): recebe a lista COMPLETA de ids
// na nova ordem desejada (campo repetido "ids" no FormData, ver botões
// subir/descer em CategoriaCustoOrdemBotoes.tsx) e grava `ordem` = índice de
// cada um. Confere que os ids batem EXATAMENTE com o conjunto de categorias
// da gráfica antes de gravar — nunca confia numa lista vinda do form sem
// revalidar contra o banco (mesmo cuidado de isolamento de tenant do resto
// deste arquivo).
export async function reordenarCategoriasCusto(
  _estadoAnterior: SalvarCategoriaCustoResult | null,
  formData: FormData
): Promise<SalvarCategoriaCustoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const ids = formData.getAll("ids").map(String);
  if (ids.length === 0) {
    return { ok: false, mensagem: "Nada para reordenar." };
  }

  const categorias = await prisma.categoriaCusto.findMany({
    where: { graficaId: usuario.graficaId },
    select: { id: true },
  });
  const idsValidos = new Set(categorias.map((categoria) => categoria.id));
  const idsUnicos = new Set(ids);
  const listaBate =
    ids.length === categorias.length &&
    idsUnicos.size === ids.length &&
    ids.every((id) => idsValidos.has(id));
  if (!listaBate) {
    return { ok: false, mensagem: "Lista de categorias desatualizada — recarregue a página." };
  }

  await prisma.$transaction(
    ids.map((id, indice) =>
      prisma.categoriaCusto.update({ where: { id }, data: { ordem: indice } })
    )
  );

  revalidatePath("/configuracoes/categorias-custo");
  return { ok: true, mensagem: "Ordem atualizada." };
}
