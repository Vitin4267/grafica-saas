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
import { ROTULOS_STATUS_SOLICITACAO_COMPRA, TRANSICOES_VALIDAS, type StatusSolicitacaoCompra } from "@/lib/compras-status";
import { avancarStatusCompra, type SolicitacaoParaTransicao } from "./status-transicao";

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar compras.";

// Resolve e valida (tenant + tipo + variante) o alvo de uma solicitação de
// compra — mesma lógica de resolverItemMateriaPrima em
// src/app/catalogo/[itemGraficaId]/actions.ts, mas não é importado de lá
// (função privada daquele arquivo): duplicada aqui de propósito, é pequena
// o bastante pra não valer a pena promover a um helper compartilhado ainda.
async function resolverItemMateriaPrima(itemGraficaId: string, varianteId: string | undefined, graficaId: string) {
  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId, itemCatalogo: { tipo: "MATERIA_PRIMA" } },
    include: { itemCatalogo: true, variantes: { where: { ativo: true } } },
  });
  if (!itemGrafica) return null;
  if (varianteId) {
    const variante = itemGrafica.variantes.find((v) => v.id === varianteId);
    if (!variante) return null;
    return { itemGrafica, variante };
  }
  return { itemGrafica, variante: null as (typeof itemGrafica.variantes)[number] | null };
}

export type CriarSolicitacaoResult = { ok: boolean; mensagem: string };

const criarSchema = z.object({
  itemGraficaId: z.string().min(1, "Selecione uma matéria-prima."),
  varianteId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? v : undefined)),
  fornecedorId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? v : undefined)),
  quantidade: z.coerce.number().positive("Quantidade deve ser maior que zero."),
  valorEstimado: z.coerce.number().positive("Valor estimado deve ser maior que zero.").optional(),
  observacao: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

// Cria uma nova SolicitacaoCompra em SOLICITADO — o começo do fluxo
// SOLICITADO→COTANDO→APROVADO→COMPRADO→RECEBIDO→CONFERIDO (ver
// src/lib/compras-status.ts). itemGraficaId pode vir pré-preenchido pela
// tela /compras a partir da sugestão de estoque baixo (ver
// calcularPrevisaoEstoque), mas sempre revalidado aqui contra a gráfica do
// usuário — nunca confia em nada vindo do client.
export async function criarSolicitacaoCompra(
  _estadoAnterior: CriarSolicitacaoResult | null,
  formData: FormData
): Promise<CriarSolicitacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "COMPRAS"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = criarSchema.safeParse({
    itemGraficaId: formData.get("itemGraficaId"),
    varianteId: formData.get("varianteId") || undefined,
    fornecedorId: formData.get("fornecedorId") || undefined,
    quantidade: formData.get("quantidade"),
    valorEstimado: formData.get("valorEstimado") || undefined,
    observacao: formData.get("observacao") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const { itemGraficaId, varianteId, fornecedorId, quantidade, valorEstimado, observacao } = parsed.data;

  const resolvido = await resolverItemMateriaPrima(itemGraficaId, varianteId, usuario.graficaId);
  if (!resolvido) {
    return { ok: false, mensagem: "Matéria-prima não encontrada." };
  }
  const { itemGrafica, variante } = resolvido;
  const nomeItem = `${itemGrafica.itemCatalogo.nome}${variante ? ` (${variante.rotulo})` : ""}`;

  let fornecedorValidoId: string | null = null;
  if (fornecedorId) {
    const fornecedorValido = await prisma.fornecedor.findFirst({
      where: { id: fornecedorId, graficaId: usuario.graficaId },
      select: { id: true },
    });
    if (!fornecedorValido) {
      return { ok: false, mensagem: "Fornecedor selecionado é inválido." };
    }
    fornecedorValidoId = fornecedorValido.id;
  }

  const novaSolicitacao = await prisma.solicitacaoCompra.create({
    data: {
      graficaId: usuario.graficaId,
      itemGraficaId: itemGrafica.id,
      varianteId: variante?.id ?? null,
      fornecedorId: fornecedorValidoId,
      quantidade: quantidade.toFixed(4),
      valorEstimado: valorEstimado !== undefined ? valorEstimado.toFixed(2) : null,
      observacao: observacao ?? null,
      usuarioSolicitanteId: usuario.id,
    },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "compras.solicitar",
    entidade: "SolicitacaoCompra",
    entidadeId: novaSolicitacao.id,
    descricao: `Solicitação de compra de "${nomeItem}" (${quantidade}) criada`,
  });

  revalidatePath("/compras");
  redirect(`/compras/${novaSolicitacao.id}`);
}

export type TransicaoCompraResult = { ok: boolean; mensagem: string };

const STATUS_DESTINO_VALIDOS = new Set<StatusSolicitacaoCompra>([
  "COTANDO",
  "APROVADO",
  "COMPRADO",
  "RECEBIDO",
  "CONFERIDO",
  "CANCELADO",
]);

// Lê um campo opcional de transição da FormData: ausente = "não mexer nesse
// campo" (undefined), presente e vazio = "limpar" (null), presente com
// valor = o valor. Usado pelos campos contextuais do formulário de
// transição (fornecedor, documento) — só entram no FormData quando a etapa
// atual da tela realmente os mostra (ver AcoesSolicitacaoForm.tsx).
function campoOpcionalTransicao(formData: FormData, nome: string): string | null | undefined {
  if (!formData.has(nome)) return undefined;
  const valor = String(formData.get(nome) ?? "").trim();
  return valor === "" ? null : valor;
}

// Avança (ou cancela) uma SolicitacaoCompra — um único ponto de entrada pra
// toda transição de status, reaproveitando avancarStatusCompra
// (./status-transicao.ts) pro CAS + baixa de estoque condicional. Os campos
// contextuais (fornecedor, valor final, documento) só têm efeito nas
// etapas em que fazem sentido — ver DadosTransicaoCompra.
export async function avancarSolicitacaoCompra(
  _estadoAnterior: TransicaoCompraResult | null,
  formData: FormData
): Promise<TransicaoCompraResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "COMPRAS"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const solicitacaoId = String(formData.get("solicitacaoId") ?? "");
  const proximoStatusBruto = String(formData.get("proximoStatus") ?? "");
  if (!STATUS_DESTINO_VALIDOS.has(proximoStatusBruto as StatusSolicitacaoCompra)) {
    return { ok: false, mensagem: "Status de destino inválido." };
  }
  const proximoStatus = proximoStatusBruto as StatusSolicitacaoCompra;

  const solicitacao = await prisma.solicitacaoCompra.findFirst({
    where: { id: solicitacaoId, graficaId: usuario.graficaId },
    include: { itemGrafica: { include: { itemCatalogo: true } }, variante: true },
  });
  if (!solicitacao) {
    return { ok: false, mensagem: "Solicitação não encontrada." };
  }
  if (!TRANSICOES_VALIDAS[solicitacao.status].includes(proximoStatus)) {
    return {
      ok: false,
      mensagem: `Não é possível mudar de "${ROTULOS_STATUS_SOLICITACAO_COMPRA[solicitacao.status]}" para "${ROTULOS_STATUS_SOLICITACAO_COMPRA[proximoStatus]}".`,
    };
  }

  const fornecedorIdBruto = campoOpcionalTransicao(formData, "fornecedorId");
  if (fornecedorIdBruto) {
    const fornecedorValido = await prisma.fornecedor.findFirst({
      where: { id: fornecedorIdBruto, graficaId: usuario.graficaId },
      select: { id: true },
    });
    if (!fornecedorValido) {
      return { ok: false, mensagem: "Fornecedor selecionado é inválido." };
    }
  }

  const documentoBruto = campoOpcionalTransicao(formData, "documento");

  let valorFinal: number | null | undefined;
  const valorFinalTexto = formData.has("valorFinal") ? String(formData.get("valorFinal") ?? "").trim() : undefined;
  if (valorFinalTexto === undefined) {
    valorFinal = undefined;
  } else if (valorFinalTexto === "") {
    valorFinal = null;
  } else {
    const numero = Number(valorFinalTexto);
    if (!Number.isFinite(numero) || numero <= 0) {
      return { ok: false, mensagem: "Valor final inválido." };
    }
    valorFinal = numero;
  }

  const nomeItem = `${solicitacao.itemGrafica.itemCatalogo.nome}${solicitacao.variante ? ` (${solicitacao.variante.rotulo})` : ""}`;

  const solicitacaoParaTransicao: SolicitacaoParaTransicao = {
    id: solicitacao.id,
    graficaId: solicitacao.graficaId,
    status: solicitacao.status,
    itemGraficaId: solicitacao.itemGraficaId,
    varianteId: solicitacao.varianteId,
    quantidade: solicitacao.quantidade,
    valorFinal: solicitacao.valorFinal,
    fornecedorId: solicitacao.fornecedorId,
    documento: solicitacao.documento,
  };

  const resultado = await avancarStatusCompra(solicitacaoParaTransicao, proximoStatus, usuario, {
    fornecedorId: fornecedorIdBruto,
    documento: documentoBruto,
    valorFinal,
  });

  if (resultado.ok) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: `compras.status_${proximoStatus.toLowerCase()}`,
      entidade: "SolicitacaoCompra",
      entidadeId: solicitacao.id,
      descricao: `Solicitação de compra de "${nomeItem}" mudou de status`,
      valorAnterior: ROTULOS_STATUS_SOLICITACAO_COMPRA[resultado.statusAnterior],
      valorNovo: ROTULOS_STATUS_SOLICITACAO_COMPRA[resultado.proximoStatus],
    });
  }

  return resultado;
}
