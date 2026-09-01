"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type {
  TipoFerramental,
  ProprietarioFerramental,
  StatusFerramental,
} from "@/generated/prisma/enums";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";
import {
  ORDEM_TIPO_FERRAMENTAL,
  ORDEM_PROPRIETARIO_FERRAMENTAL,
  ORDEM_STATUS_FERRAMENTAL,
  rotuloTipoFerramental,
  ROTULO_PROPRIETARIO_FERRAMENTAL,
  ROTULO_STATUS_FERRAMENTAL,
} from "@/lib/tipos-ferramental";

export type SalvarFerramentalResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_CODIGO_VAZIO = "Informe um código para identificar o ferramental.";
const MENSAGEM_CODIGO_DUPLICADO = "Já existe um ferramental com esse código.";

// Mesmo padrão do resto do schema (CategoriaEquipamento, MaterialSubstrato
// etc.): tipo vem de uma lista fechada com OUTRO de escape — tipoOutro só é
// obrigatório nesse caso.
function validarTipo(
  formData: FormData
): { ok: true; tipo: TipoFerramental; tipoOutro: string | null } | { ok: false; mensagem: string } {
  const tipo = String(formData.get("tipo") ?? "");
  if (!ORDEM_TIPO_FERRAMENTAL.includes(tipo as TipoFerramental)) {
    return { ok: false, mensagem: "Selecione um tipo de ferramental." };
  }
  if (tipo === "OUTRO") {
    const tipoOutro = String(formData.get("tipoOutro") ?? "").trim();
    if (!tipoOutro) {
      return { ok: false, mensagem: 'Descreva o tipo quando escolher "Outro".' };
    }
    return { ok: true, tipo: "OUTRO", tipoOutro };
  }
  return { ok: true, tipo: tipo as TipoFerramental, tipoOutro: null };
}

// clienteId nunca é lido "porque veio preenchido no form" — o servidor
// re-deriva a partir de `proprietario` (regra permanente do projeto: tudo
// sensível/estrutural é validado no backend). proprietario=GRAFICA sempre
// zera clienteId, mesmo que o client mande algo — o campo só é exibido no
// form quando proprietario=CLIENTE, mas um form adulterado não pode gravar
// um dono incoerente com o proprietário escolhido.
async function validarProprietarioECliente(
  formData: FormData,
  graficaId: string
): Promise<
  | { ok: true; proprietario: ProprietarioFerramental; clienteId: string | null }
  | { ok: false; mensagem: string }
> {
  const proprietario = String(formData.get("proprietario") ?? "");
  if (!ORDEM_PROPRIETARIO_FERRAMENTAL.includes(proprietario as ProprietarioFerramental)) {
    return { ok: false, mensagem: "Selecione o proprietário do ferramental." };
  }
  if (proprietario === "GRAFICA") {
    return { ok: true, proprietario: "GRAFICA", clienteId: null };
  }

  const clienteId = String(formData.get("clienteId") ?? "").trim();
  if (!clienteId) {
    return { ok: false, mensagem: "Selecione o cliente dono deste ferramental." };
  }
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId },
    select: { id: true },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }
  return { ok: true, proprietario: "CLIENTE", clienteId };
}

async function validarItemGrafica(
  formData: FormData,
  graficaId: string
): Promise<{ ok: true; itemGraficaId: string | null } | { ok: false; mensagem: string }> {
  const bruto = String(formData.get("itemGraficaId") ?? "").trim();
  if (!bruto) {
    return { ok: true, itemGraficaId: null };
  }
  const item = await prisma.itemGrafica.findFirst({
    where: { id: bruto, graficaId },
    select: { id: true },
  });
  if (!item) {
    return { ok: false, mensagem: "Item do catálogo não encontrado." };
  }
  return { ok: true, itemGraficaId: bruto };
}

function validarStatus(
  formData: FormData
): { ok: true; status: StatusFerramental } | { ok: false; mensagem: string } {
  const status = String(formData.get("status") ?? "ATIVO");
  if (!ORDEM_STATUS_FERRAMENTAL.includes(status as StatusFerramental)) {
    return { ok: false, mensagem: "Status inválido." };
  }
  return { ok: true, status: status as StatusFerramental };
}

// Campo puramente informativo (ver comentário no schema) — mesmo padrão de
// validação "string vazia vira null/valor padrão, valor inválido é
// rejeitado" já usado no resto do projeto.
function validarTiragensAcumuladas(
  formData: FormData
): { ok: true; valor: number } | { ok: false; mensagem: string } {
  const bruto = formData.get("tiragensAcumuladas");
  if (typeof bruto !== "string" || bruto.trim() === "") {
    return { ok: true, valor: 0 };
  }
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor < 0) {
    return { ok: false, mensagem: "Tiragens acumuladas inválidas — use um número inteiro maior ou igual a zero." };
  }
  return { ok: true, valor };
}

function rotuloProprietario(proprietario: ProprietarioFerramental): string {
  return ROTULO_PROPRIETARIO_FERRAMENTAL[proprietario];
}

function rotuloStatus(status: StatusFerramental): string {
  return ROTULO_STATUS_FERRAMENTAL[status];
}

export async function criarFerramental(
  _estadoAnterior: SalvarFerramentalResult | null,
  formData: FormData
): Promise<SalvarFerramentalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const codigo = String(formData.get("codigo") ?? "").trim();
  if (!codigo) {
    return { ok: false, mensagem: MENSAGEM_CODIGO_VAZIO };
  }

  const validacaoTipo = validarTipo(formData);
  if (!validacaoTipo.ok) {
    return validacaoTipo;
  }

  const validacaoProprietario = await validarProprietarioECliente(formData, usuario.graficaId);
  if (!validacaoProprietario.ok) {
    return validacaoProprietario;
  }

  const validacaoItem = await validarItemGrafica(formData, usuario.graficaId);
  if (!validacaoItem.ok) {
    return validacaoItem;
  }

  const validacaoStatus = validarStatus(formData);
  if (!validacaoStatus.ok) {
    return validacaoStatus;
  }

  const descricao = String(formData.get("descricao") ?? "").trim() || null;
  const localizacao = String(formData.get("localizacao") ?? "").trim() || null;

  let novoFerramental: { id: string };
  try {
    novoFerramental = await prisma.ferramental.create({
      data: {
        graficaId: usuario.graficaId,
        tipo: validacaoTipo.tipo,
        tipoOutro: validacaoTipo.tipoOutro,
        codigo,
        descricao,
        clienteId: validacaoProprietario.clienteId,
        proprietario: validacaoProprietario.proprietario,
        itemGraficaId: validacaoItem.itemGraficaId,
        localizacao,
        status: validacaoStatus.status,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_CODIGO_DUPLICADO };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_ferramental",
    entidade: "Ferramental",
    entidadeId: novoFerramental.id,
    descricao: `Ferramental "${codigo}" (${rotuloTipoFerramental(validacaoTipo.tipo, validacaoTipo.tipoOutro)}) criado`,
  });

  revalidatePath("/configuracoes/ferramentais");
  redirect(`/configuracoes/ferramentais/${novoFerramental.id}`);
}

export async function editarFerramental(
  _estadoAnterior: SalvarFerramentalResult | null,
  formData: FormData
): Promise<SalvarFerramentalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const ferramentalId = String(formData.get("ferramentalId"));
  const ferramental = await prisma.ferramental.findFirst({
    where: { id: ferramentalId, graficaId: usuario.graficaId },
  });
  if (!ferramental) {
    return { ok: false, mensagem: "Ferramental não encontrado." };
  }

  const codigo = String(formData.get("codigo") ?? "").trim();
  if (!codigo) {
    return { ok: false, mensagem: MENSAGEM_CODIGO_VAZIO };
  }

  const validacaoTipo = validarTipo(formData);
  if (!validacaoTipo.ok) {
    return validacaoTipo;
  }

  const validacaoProprietario = await validarProprietarioECliente(formData, usuario.graficaId);
  if (!validacaoProprietario.ok) {
    return validacaoProprietario;
  }

  const validacaoItem = await validarItemGrafica(formData, usuario.graficaId);
  if (!validacaoItem.ok) {
    return validacaoItem;
  }

  const validacaoStatus = validarStatus(formData);
  if (!validacaoStatus.ok) {
    return validacaoStatus;
  }

  const validacaoTiragens = validarTiragensAcumuladas(formData);
  if (!validacaoTiragens.ok) {
    return validacaoTiragens;
  }

  const descricao = String(formData.get("descricao") ?? "").trim() || null;
  const localizacao = String(formData.get("localizacao") ?? "").trim() || null;

  try {
    await prisma.ferramental.update({
      where: { id: ferramentalId },
      data: {
        tipo: validacaoTipo.tipo,
        tipoOutro: validacaoTipo.tipoOutro,
        codigo,
        descricao,
        clienteId: validacaoProprietario.clienteId,
        proprietario: validacaoProprietario.proprietario,
        itemGraficaId: validacaoItem.itemGraficaId,
        localizacao,
        status: validacaoStatus.status,
        tiragensAcumuladas: validacaoTiragens.valor,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_CODIGO_DUPLICADO };
    }
    throw erro;
  }

  const diff = criarDiffCampos();
  diff.campo("Código", ferramental.codigo, codigo);
  diff.campo(
    "Tipo",
    rotuloTipoFerramental(ferramental.tipo, ferramental.tipoOutro),
    rotuloTipoFerramental(validacaoTipo.tipo, validacaoTipo.tipoOutro)
  );
  diff.campo("Descrição", ferramental.descricao, descricao);
  diff.campo(
    "Proprietário",
    rotuloProprietario(ferramental.proprietario),
    rotuloProprietario(validacaoProprietario.proprietario)
  );
  diff.campo("Cliente vinculado", ferramental.clienteId, validacaoProprietario.clienteId);
  diff.campo("Item do catálogo vinculado", ferramental.itemGraficaId, validacaoItem.itemGraficaId);
  diff.campo("Localização", ferramental.localizacao, localizacao);
  diff.campo("Status", rotuloStatus(ferramental.status), rotuloStatus(validacaoStatus.status));
  diff.campo("Tiragens acumuladas", ferramental.tiragensAcumuladas, validacaoTiragens.valor);
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.editar_ferramental",
      entidade: "Ferramental",
      entidadeId: ferramentalId,
      descricao: `Ferramental "${ferramental.codigo}" atualizado`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/ferramentais/${ferramentalId}`);
  revalidatePath("/configuracoes/ferramentais");
  return { ok: true, mensagem: "Ferramental salvo com sucesso!" };
}

// Nunca hard delete (ver comentário do model no schema) — desativadoEm marca
// remoção reversível, mesmo precedente de Cliente.desativadoEm. Ao contrário
// de Fornecedor/CategoriaCusto (boolean `ativa`/`ativo`), aqui são duas
// actions separadas (mesmo padrão de desativarCliente/reativarCliente em
// src/app/clientes/actions.ts) porque o campo é timestamp, não boolean.
export async function desativarFerramental(
  _estadoAnterior: SalvarFerramentalResult | null,
  formData: FormData
): Promise<SalvarFerramentalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const ferramentalId = String(formData.get("ferramentalId"));
  const ferramental = await prisma.ferramental.findFirst({
    where: { id: ferramentalId, graficaId: usuario.graficaId },
  });
  if (!ferramental) {
    return { ok: false, mensagem: "Ferramental não encontrado." };
  }
  if (ferramental.desativadoEm) {
    return { ok: true, mensagem: "Ferramental já estava desativado." };
  }

  await prisma.ferramental.update({
    where: { id: ferramentalId },
    data: { desativadoEm: new Date() },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.desativar_ferramental",
    entidade: "Ferramental",
    entidadeId: ferramentalId,
    descricao: `Ferramental "${ferramental.codigo}" desativado`,
  });

  revalidatePath(`/configuracoes/ferramentais/${ferramentalId}`);
  revalidatePath("/configuracoes/ferramentais");
  return { ok: true, mensagem: "Ferramental desativado." };
}

export async function reativarFerramental(
  _estadoAnterior: SalvarFerramentalResult | null,
  formData: FormData
): Promise<SalvarFerramentalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const ferramentalId = String(formData.get("ferramentalId"));
  const ferramental = await prisma.ferramental.findFirst({
    where: { id: ferramentalId, graficaId: usuario.graficaId },
  });
  if (!ferramental) {
    return { ok: false, mensagem: "Ferramental não encontrado." };
  }
  if (!ferramental.desativadoEm) {
    return { ok: true, mensagem: "Ferramental já estava ativo." };
  }

  await prisma.ferramental.update({
    where: { id: ferramentalId },
    data: { desativadoEm: null },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.reativar_ferramental",
    entidade: "Ferramental",
    entidadeId: ferramentalId,
    descricao: `Ferramental "${ferramental.codigo}" reativado`,
  });

  revalidatePath(`/configuracoes/ferramentais/${ferramentalId}`);
  revalidatePath("/configuracoes/ferramentais");
  return { ok: true, mensagem: "Ferramental reativado." };
}
