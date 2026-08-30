"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { dataInputParaUTC } from "@/lib/data";
import { UNIDADES_COMPRA, type UnidadeCompra } from "@/lib/unidade-compra";
import { formatoMoeda } from "@/lib/moeda";

// Achado A9 da auditoria de abrangência (Parte 3/Compras, 2026-08-30) —
// CRUD do contrato de fornecimento com preço fixo por período (ver model
// ContratoFornecimento no schema). Mesmo padrão de
// src/app/configuracoes/fornecedores/actions.ts: criar/editar/alternar
// ativo, nunca delete físico (histórico de SolicitacaoCompra vinculada
// precisa sobreviver).

export type SalvarContratoResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar compras.";

// Resolve e valida (tenant + tipo + variante) o item/variante opcional de um
// contrato — mesma lógica de resolverItemMateriaPrima em ../actions.ts, mas
// aqui os dois (item e variante) são opcionais: contrato "coringa" cobre
// qualquer matéria-prima do fornecedor.
async function resolverItemOpcional(
  itemGraficaId: string | undefined,
  varianteId: string | undefined,
  graficaId: string
): Promise<{ ok: true; itemGraficaId: string | null; varianteId: string | null } | { ok: false; mensagem: string }> {
  if (!itemGraficaId) {
    return { ok: true, itemGraficaId: null, varianteId: null };
  }
  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId, itemCatalogo: { tipo: "MATERIA_PRIMA" } },
    include: { variantes: { where: { ativo: true } } },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Matéria-prima selecionada é inválida." };
  }
  if (!varianteId) {
    return { ok: true, itemGraficaId: itemGrafica.id, varianteId: null };
  }
  const variante = itemGrafica.variantes.find((v) => v.id === varianteId);
  if (!variante) {
    return { ok: false, mensagem: "Variante selecionada é inválida." };
  }
  return { ok: true, itemGraficaId: itemGrafica.id, varianteId: variante.id };
}

const contratoSchema = z.object({
  fornecedorId: z.string().min(1, "Selecione um fornecedor."),
  itemGraficaId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? v : undefined)),
  varianteId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? v : undefined)),
  precoUnitario: z.coerce.number().positive("Preço unitário deve ser maior que zero."),
  unidadeCompra: z.enum(UNIDADES_COMPRA as [UnidadeCompra, ...UnidadeCompra[]], {
    message: "Selecione a unidade de compra.",
  }),
  unidadeCompraOutro: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : undefined)),
  vigenciaInicio: z.string().trim().min(1, "Informe o início da vigência."),
  vigenciaFim: z.string().trim().min(1, "Informe o fim da vigência."),
  quantidadeContratada: z.coerce.number().positive("Quantidade contratada deve ser maior que zero.").optional(),
  condicaoPagamento: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
  observacao: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

function lerContratoFormData(formData: FormData) {
  return contratoSchema.safeParse({
    fornecedorId: formData.get("fornecedorId"),
    itemGraficaId: formData.get("itemGraficaId") || undefined,
    varianteId: formData.get("varianteId") || undefined,
    precoUnitario: formData.get("precoUnitario"),
    unidadeCompra: formData.get("unidadeCompra"),
    unidadeCompraOutro: formData.get("unidadeCompraOutro") || undefined,
    vigenciaInicio: formData.get("vigenciaInicio"),
    vigenciaFim: formData.get("vigenciaFim"),
    quantidadeContratada: formData.get("quantidadeContratada") || undefined,
    condicaoPagamento: formData.get("condicaoPagamento") || undefined,
    observacao: formData.get("observacao") || undefined,
  });
}

// Cria um novo ContratoFornecimento — nasce sempre ativo=true.
export async function criarContratoFornecimento(
  _estadoAnterior: SalvarContratoResult | null,
  formData: FormData
): Promise<SalvarContratoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "COMPRAS"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = lerContratoFormData(formData);
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const {
    fornecedorId,
    itemGraficaId,
    varianteId,
    precoUnitario,
    unidadeCompra,
    unidadeCompraOutro,
    vigenciaInicio,
    vigenciaFim,
    quantidadeContratada,
    condicaoPagamento,
    observacao,
  } = parsed.data;

  const vigenciaInicioData = dataInputParaUTC(vigenciaInicio);
  const vigenciaFimData = dataInputParaUTC(vigenciaFim);
  if (vigenciaFimData.getTime() <= vigenciaInicioData.getTime()) {
    return { ok: false, mensagem: "O fim da vigência deve ser depois do início." };
  }

  const fornecedor = await prisma.fornecedor.findFirst({
    where: { id: fornecedorId, graficaId: usuario.graficaId },
    select: { id: true, nome: true },
  });
  if (!fornecedor) {
    return { ok: false, mensagem: "Fornecedor selecionado é inválido." };
  }

  const resolvidoItem = await resolverItemOpcional(itemGraficaId, varianteId, usuario.graficaId);
  if (!resolvidoItem.ok) {
    return { ok: false, mensagem: resolvidoItem.mensagem };
  }

  const novoContrato = await prisma.contratoFornecimento.create({
    data: {
      graficaId: usuario.graficaId,
      fornecedorId: fornecedor.id,
      itemGraficaId: resolvidoItem.itemGraficaId,
      varianteId: resolvidoItem.varianteId,
      precoUnitario: precoUnitario.toFixed(4),
      unidadeCompra,
      unidadeCompraOutro: unidadeCompra === "OUTRO" ? (unidadeCompraOutro ?? null) : null,
      vigenciaInicio: vigenciaInicioData,
      vigenciaFim: vigenciaFimData,
      quantidadeContratada: quantidadeContratada !== undefined ? quantidadeContratada.toFixed(4) : null,
      condicaoPagamento: condicaoPagamento ?? null,
      observacao: observacao ?? null,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "compras.criar_contrato_fornecimento",
    entidade: "ContratoFornecimento",
    entidadeId: novoContrato.id,
    descricao: `Contrato de fornecimento com "${fornecedor.nome}" criado (${formatoMoeda.format(precoUnitario)}/unidade)`,
  });

  revalidatePath("/compras/contratos");
  revalidatePath("/compras/nova");
  redirect(`/compras/contratos/${novoContrato.id}`);
}

// Edita um contrato já existente — nunca mexe em `ativo` (ver
// alternarAtivoContratoFornecimento) nem em `quantidadeConsumida` (só
// incrementada via avancarStatusCompra, RECEBIDO).
export async function editarContratoFornecimento(
  _estadoAnterior: SalvarContratoResult | null,
  formData: FormData
): Promise<SalvarContratoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "COMPRAS"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const contratoId = String(formData.get("contratoId") ?? "");
  const contrato = await prisma.contratoFornecimento.findFirst({
    where: { id: contratoId, graficaId: usuario.graficaId },
  });
  if (!contrato) {
    return { ok: false, mensagem: "Contrato não encontrado." };
  }

  const parsed = lerContratoFormData(formData);
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const {
    fornecedorId,
    itemGraficaId,
    varianteId,
    precoUnitario,
    unidadeCompra,
    unidadeCompraOutro,
    vigenciaInicio,
    vigenciaFim,
    quantidadeContratada,
    condicaoPagamento,
    observacao,
  } = parsed.data;

  const vigenciaInicioData = dataInputParaUTC(vigenciaInicio);
  const vigenciaFimData = dataInputParaUTC(vigenciaFim);
  if (vigenciaFimData.getTime() <= vigenciaInicioData.getTime()) {
    return { ok: false, mensagem: "O fim da vigência deve ser depois do início." };
  }

  const fornecedor = await prisma.fornecedor.findFirst({
    where: { id: fornecedorId, graficaId: usuario.graficaId },
    select: { id: true, nome: true },
  });
  if (!fornecedor) {
    return { ok: false, mensagem: "Fornecedor selecionado é inválido." };
  }

  const resolvidoItem = await resolverItemOpcional(itemGraficaId, varianteId, usuario.graficaId);
  if (!resolvidoItem.ok) {
    return { ok: false, mensagem: resolvidoItem.mensagem };
  }

  // quantidadeContratada não pode cair abaixo do que já foi consumido — só
  // travaria o alerta de "próximo do limite" em 100%+ pra sempre sem
  // nenhuma ação possível pra quem administra o contrato reconhecer que o
  // teto real é outro.
  if (quantidadeContratada !== undefined && quantidadeContratada < Number(contrato.quantidadeConsumida)) {
    return {
      ok: false,
      mensagem: `Quantidade contratada não pode ser menor que a já consumida (${Number(contrato.quantidadeConsumida)}).`,
    };
  }

  await prisma.contratoFornecimento.update({
    where: { id: contratoId },
    data: {
      fornecedorId: fornecedor.id,
      itemGraficaId: resolvidoItem.itemGraficaId,
      varianteId: resolvidoItem.varianteId,
      precoUnitario: precoUnitario.toFixed(4),
      unidadeCompra,
      unidadeCompraOutro: unidadeCompra === "OUTRO" ? (unidadeCompraOutro ?? null) : null,
      vigenciaInicio: vigenciaInicioData,
      vigenciaFim: vigenciaFimData,
      quantidadeContratada: quantidadeContratada !== undefined ? quantidadeContratada.toFixed(4) : null,
      condicaoPagamento: condicaoPagamento ?? null,
      observacao: observacao ?? null,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "compras.editar_contrato_fornecimento",
    entidade: "ContratoFornecimento",
    entidadeId: contratoId,
    descricao: `Contrato de fornecimento com "${fornecedor.nome}" atualizado`,
  });

  revalidatePath(`/compras/contratos/${contratoId}`);
  revalidatePath("/compras/contratos");
  revalidatePath("/compras/nova");
  return { ok: true, mensagem: "Contrato atualizado com sucesso!" };
}

// Alterna ativo/inativo — equivalente de "remover" (mesmo padrão de
// alternarAtivoFornecedor). Um contrato inativo nunca é ofertado/usado
// automaticamente em criarSolicitacaoCompra (revalidado lá contra
// ativo=true), mas o histórico de solicitações já vinculadas a ele continua
// intacto.
export async function alternarAtivoContratoFornecimento(
  _estadoAnterior: SalvarContratoResult | null,
  formData: FormData
): Promise<SalvarContratoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "COMPRAS"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const contratoId = String(formData.get("contratoId") ?? "");
  const contrato = await prisma.contratoFornecimento.findFirst({
    where: { id: contratoId, graficaId: usuario.graficaId },
    include: { fornecedor: { select: { nome: true } } },
  });
  if (!contrato) {
    return { ok: false, mensagem: "Contrato não encontrado." };
  }

  await prisma.contratoFornecimento.update({
    where: { id: contratoId },
    data: { ativo: !contrato.ativo },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: contrato.ativo ? "compras.desativar_contrato_fornecimento" : "compras.ativar_contrato_fornecimento",
    entidade: "ContratoFornecimento",
    entidadeId: contratoId,
    descricao: `Contrato de fornecimento com "${contrato.fornecedor.nome}" ${contrato.ativo ? "desativado" : "ativado"}`,
  });

  revalidatePath(`/compras/contratos/${contratoId}`);
  revalidatePath("/compras/contratos");
  revalidatePath("/compras/nova");
  return {
    ok: true,
    mensagem: contrato.ativo ? "Contrato desativado." : "Contrato ativado.",
  };
}
