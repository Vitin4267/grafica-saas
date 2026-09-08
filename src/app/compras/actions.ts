"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  ROTULOS_STATUS_SOLICITACAO_COMPRA,
  TRANSICOES_VALIDAS,
  ORIGENS_SOLICITACAO_COMPRA,
  TIPOS_COMPRA,
  type StatusSolicitacaoCompra,
  type OrigemSolicitacaoCompra,
  type TipoCompra,
} from "@/lib/compras-status";
import { dataInputParaUTC } from "@/lib/data";
import { formatoMoeda } from "@/lib/moeda";
import { UNIDADES_COMPRA, calcularQuantidadeEstoque, type UnidadeCompra } from "@/lib/unidade-compra";
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
  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // opcional: nem toda compra tem um item do catálogo pra apontar (ver
  // descricaoLivre abaixo). Pelo menos um dos dois é exigido, validado
  // depois do parse (não dá pra expressar "OU" no schema do zod aqui sem
  // complicar o resto dos campos condicionais já existentes).
  itemGraficaId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? v : undefined)),
  descricaoLivre: z
    .string()
    .trim()
    .max(300, "Descrição deve ter no máximo 300 caracteres.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // default MATERIA_PRIMA preserva o comportamento de toda solicitação
  // criada antes desta feature (formulário antigo não manda este campo).
  tipoCompra: z
    .enum(TIPOS_COMPRA as [TipoCompra, ...TipoCompra[]])
    .optional()
    .default("MATERIA_PRIMA"),
  tipoCompraOutro: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
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
  // Achado A6 da auditoria de abrangência (Parte 3/Compras): sem
  // unidadeCompra, `quantidade` é obrigatória e usada direto (comportamento
  // de hoje). Com unidadeCompra, `quantidade` vira DERIVADA de
  // quantidadeCompra × fatorConversaoCompra (recalculada aqui, nunca confia
  // no que o client mandaria pra ela) — por isso opcional no schema, a
  // obrigatoriedade condicional é validada abaixo.
  quantidade: z.coerce.number().positive("Quantidade deve ser maior que zero.").optional(),
  unidadeCompra: z.enum(UNIDADES_COMPRA as [UnidadeCompra, ...UnidadeCompra[]]).optional(),
  unidadeCompraOutro: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : undefined)),
  quantidadeCompra: z.coerce.number().positive("Quantidade de compra deve ser maior que zero.").optional(),
  fatorConversaoCompra: z.coerce.number().positive("Fator de conversão deve ser maior que zero.").optional(),
  precoUnitarioCompra: z.coerce.number().positive("Preço unitário de compra deve ser maior que zero.").optional(),
  valorEstimado: z.coerce.number().positive("Valor estimado deve ser maior que zero.").optional(),
  observacao: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Achado A3 da auditoria de abrangência (Parte 3/Compras) — origem default
  // REPOSICAO_ESTOQUE preserva o comportamento de toda solicitação criada
  // antes desta feature (formulário antigo não manda este campo).
  origem: z
    .enum(ORIGENS_SOLICITACAO_COMPRA as [OrigemSolicitacaoCompra, ...OrigemSolicitacaoCompra[]])
    .optional()
    .default("REPOSICAO_ESTOQUE"),
  origemOutro: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
  pedidoId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Achado A9 da auditoria de abrangência (Parte 3/Compras) — preenchido só
  // quando origem=CONTRATO_PROGRAMADO (ver NovaSolicitacaoForm, botão "usar
  // este contrato"). Nunca confia nele sozinho: sempre revalidado abaixo
  // contra graficaId/ativo/vigência/escopo do item antes de usar.
  contratoFornecimentoId: z
    .string()
    .trim()
    .min(1)
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
    itemGraficaId: formData.get("itemGraficaId") || undefined,
    descricaoLivre: formData.get("descricaoLivre") || undefined,
    tipoCompra: formData.get("tipoCompra") || undefined,
    tipoCompraOutro: formData.get("tipoCompraOutro") || undefined,
    varianteId: formData.get("varianteId") || undefined,
    fornecedorId: formData.get("fornecedorId") || undefined,
    quantidade: formData.get("quantidade") || undefined,
    unidadeCompra: formData.get("unidadeCompra") || undefined,
    unidadeCompraOutro: formData.get("unidadeCompraOutro") || undefined,
    quantidadeCompra: formData.get("quantidadeCompra") || undefined,
    fatorConversaoCompra: formData.get("fatorConversaoCompra") || undefined,
    precoUnitarioCompra: formData.get("precoUnitarioCompra") || undefined,
    valorEstimado: formData.get("valorEstimado") || undefined,
    observacao: formData.get("observacao") || undefined,
    origem: formData.get("origem") || undefined,
    origemOutro: formData.get("origemOutro") || undefined,
    pedidoId: formData.get("pedidoId") || undefined,
    contratoFornecimentoId: formData.get("contratoFornecimentoId") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const {
    itemGraficaId,
    descricaoLivre,
    tipoCompra,
    tipoCompraOutro,
    varianteId,
    fornecedorId,
    quantidade,
    unidadeCompra,
    unidadeCompraOutro,
    quantidadeCompra,
    fatorConversaoCompra,
    precoUnitarioCompra,
    valorEstimado,
    observacao,
    origem,
    origemOutro,
    pedidoId,
    contratoFornecimentoId,
  } = parsed.data;

  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // pelo menos um dos dois é exigido (os dois podem coexistir, ver
  // comentário do schema); sem isso a solicitação não teria alvo nenhum
  // pra mostrar na listagem/detalhe.
  if (!itemGraficaId && !descricaoLivre) {
    return {
      ok: false,
      mensagem: "Selecione uma matéria-prima do catálogo ou descreva o que está sendo comprado.",
    };
  }

  // Achado A6 da auditoria de abrangência (Parte 3/Compras): sem
  // unidadeCompra, `quantidade` (unidade de estoque) é usada direto — 100%
  // do comportamento de hoje preservado. Com unidadeCompra, `quantidade` é
  // SEMPRE recalculada aqui a partir de quantidadeCompra × fatorConversaoCompra
  // (nunca confia em quantidade vinda do client nesse caso).
  let quantidadeFinal: number;
  let unidadeCompraOutroFinal: string | null = null;
  if (unidadeCompra) {
    // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
    // a conversão pra unidade de ESTOQUE só faz sentido quando há um item
    // do catálogo (é dele que vem a unidade de estoque, ver
    // ItemGrafica.unidadeCompraPadrao) — compra por descricaoLivre sempre
    // digita `quantidade` direto.
    if (!itemGraficaId) {
      return { ok: false, mensagem: "Unidade de compra exige selecionar um item do catálogo." };
    }
    if (quantidadeCompra === undefined || fatorConversaoCompra === undefined) {
      return {
        ok: false,
        mensagem: "Informe a quantidade e o fator de conversão da unidade de compra.",
      };
    }
    quantidadeFinal = calcularQuantidadeEstoque(quantidadeCompra, fatorConversaoCompra);
    unidadeCompraOutroFinal = unidadeCompra === "OUTRO" ? (unidadeCompraOutro ?? null) : null;
  } else {
    if (quantidade === undefined) {
      return { ok: false, mensagem: "Quantidade deve ser maior que zero." };
    }
    quantidadeFinal = quantidade;
  }

  // Achado A3 da auditoria de abrangência (Parte 3/Compras): pedidoId é
  // OBRIGATÓRIO na aplicação quando origem=PEDIDO_ESPECIFICO (nullable no
  // schema — a obrigatoriedade é condicional, não constraint de banco).
  // Pra qualquer outra origem, pedidoId enviado pelo client é ignorado —
  // nunca confia em pedidoId vindo de fora sem a origem que o justifica.
  let pedidoValidoId: string | null = null;
  if (origem === "PEDIDO_ESPECIFICO") {
    if (!pedidoId) {
      return { ok: false, mensagem: "Selecione o pedido pra esta compra sob encomenda." };
    }
    const pedidoValido = await prisma.pedido.findFirst({
      where: { id: pedidoId, graficaId: usuario.graficaId },
      select: { id: true },
    });
    if (!pedidoValido) {
      return { ok: false, mensagem: "Pedido selecionado é inválido." };
    }
    pedidoValidoId = pedidoValido.id;
  }

  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // só resolve contra o catálogo quando itemGraficaId foi informado; sem
  // ele (compra por descricaoLivre) itemGrafica/variante ficam null e o
  // nome exibido cai pra descrição livre digitada.
  const resolvido = itemGraficaId
    ? await resolverItemMateriaPrima(itemGraficaId, varianteId, usuario.graficaId)
    : null;
  if (itemGraficaId && !resolvido) {
    return { ok: false, mensagem: "Matéria-prima não encontrada." };
  }
  const itemGrafica = resolvido?.itemGrafica ?? null;
  const variante = resolvido?.variante ?? null;
  const nomeItem = itemGrafica
    ? `${itemGrafica.itemCatalogo.nome}${variante ? ` (${variante.rotulo})` : ""}`
    : (descricaoLivre ?? "Compra avulsa");

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

  // Achado A9 da auditoria de abrangência (Parte 3/Compras) — dá função de
  // verdade a origem=CONTRATO_PROGRAMADO: revalida o contrato inteiro contra
  // o tenant/vigência/escopo (nunca confia em contratoFornecimentoId vindo do
  // client sozinho) e, se válido, a solicitação nasce já em APROVADO com
  // fornecedor/valor copiados do contrato — pula a etapa de cotação.
  let statusInicial: StatusSolicitacaoCompra = "SOLICITADO";
  let aprovadoEmInicial: Date | null = null;
  let usuarioAprovadorIdInicial: string | null = null;
  let contratoValidoId: string | null = null;
  let valorEstimadoFinal = valorEstimado;

  if (origem === "CONTRATO_PROGRAMADO") {
    // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
    // ContratoFornecimento é sempre sobre um item do catálogo (ou "coringa"
    // pra qualquer item do fornecedor) — sem itemGrafica resolvido não há
    // como validar escopo do contrato contra nada.
    if (!itemGrafica) {
      return { ok: false, mensagem: "Contrato de fornecimento exige selecionar uma matéria-prima do catálogo." };
    }
    if (!contratoFornecimentoId) {
      return { ok: false, mensagem: "Selecione o contrato de fornecimento pra esta compra programada." };
    }
    const agora = new Date();
    const contrato = await prisma.contratoFornecimento.findFirst({
      where: {
        id: contratoFornecimentoId,
        graficaId: usuario.graficaId,
        ativo: true,
        vigenciaInicio: { lte: agora },
        vigenciaFim: { gte: agora },
      },
    });
    if (!contrato) {
      return { ok: false, mensagem: "Contrato de fornecimento inválido, inativo ou fora da vigência." };
    }
    if (contrato.itemGraficaId && contrato.itemGraficaId !== itemGrafica.id) {
      return { ok: false, mensagem: "Este contrato não cobre a matéria-prima selecionada." };
    }
    if (contrato.varianteId && contrato.varianteId !== (variante?.id ?? null)) {
      return { ok: false, mensagem: "Este contrato não cobre a variante selecionada." };
    }
    contratoValidoId = contrato.id;
    fornecedorValidoId = contrato.fornecedorId; // sempre o do contrato, nunca o enviado pelo form
    valorEstimadoFinal = Number(contrato.precoUnitario) * quantidadeFinal;
    statusInicial = "APROVADO";
    aprovadoEmInicial = agora;
    usuarioAprovadorIdInicial = usuario.id;
  }

  const novaSolicitacao = await prisma.solicitacaoCompra.create({
    data: {
      graficaId: usuario.graficaId,
      itemGraficaId: itemGrafica?.id ?? null,
      descricaoLivre: descricaoLivre ?? null,
      tipoCompra,
      tipoCompraOutro: tipoCompra === "OUTRO" ? (tipoCompraOutro ?? null) : null,
      varianteId: variante?.id ?? null,
      fornecedorId: fornecedorValidoId,
      origem,
      origemOutro: origem === "OUTRO" ? (origemOutro ?? null) : null,
      pedidoId: pedidoValidoId,
      contratoFornecimentoId: contratoValidoId,
      status: statusInicial,
      aprovadoEm: aprovadoEmInicial,
      usuarioAprovadorId: usuarioAprovadorIdInicial,
      quantidade: quantidadeFinal.toFixed(4),
      unidadeCompra: unidadeCompra ?? null,
      unidadeCompraOutro: unidadeCompraOutroFinal,
      quantidadeCompra: quantidadeCompra !== undefined ? quantidadeCompra.toFixed(4) : null,
      fatorConversaoCompra: fatorConversaoCompra !== undefined ? fatorConversaoCompra.toFixed(4) : null,
      precoUnitarioCompra: precoUnitarioCompra !== undefined ? precoUnitarioCompra.toFixed(4) : null,
      valorEstimado: valorEstimadoFinal !== undefined ? valorEstimadoFinal.toFixed(2) : null,
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
    descricao: `Solicitação de compra de "${nomeItem}" (${quantidadeFinal}) criada`,
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

  // Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // mesmo campo contextual de valorFinal (só aparece em COMPRADO, ver
  // AcoesSolicitacaoForm.tsx), mas aceitando zero (diferente de valorFinal,
  // que exige > 0) — frete/IPI/ICMS/desconto zero é um valor válido, não
  // "não informado".
  function parseValorNaoNegativoOpcional(nome: string): { ok: true; valor: number | null | undefined } | { ok: false; mensagem: string } {
    if (!formData.has(nome)) return { ok: true, valor: undefined };
    const texto = String(formData.get(nome) ?? "").trim();
    if (texto === "") return { ok: true, valor: null };
    const numero = Number(texto);
    if (!Number.isFinite(numero) || numero < 0) {
      return { ok: false, mensagem: "Valor informado é inválido." };
    }
    return { ok: true, valor: numero };
  }

  const parseFrete = parseValorNaoNegativoOpcional("valorFrete");
  if (!parseFrete.ok) return { ok: false, mensagem: parseFrete.mensagem };
  const parseIpi = parseValorNaoNegativoOpcional("valorIpi");
  if (!parseIpi.ok) return { ok: false, mensagem: parseIpi.mensagem };
  const parseIcms = parseValorNaoNegativoOpcional("valorIcmsCreditavel");
  if (!parseIcms.ok) return { ok: false, mensagem: parseIcms.mensagem };
  const parseDesconto = parseValorNaoNegativoOpcional("valorDesconto");
  if (!parseDesconto.ok) return { ok: false, mensagem: parseDesconto.mensagem };

  // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
  // quantidade efetivamente recebida NESTA confirmação (só aparece no form
  // quando proximoStatus=RECEBIDO, ver camposContextuais em
  // AcoesSolicitacaoForm.tsx) — obrigatoriedade real é checada dentro de
  // avancarStatusCompra (que também sabe o restante esperado pra sugerir a
  // divergência), aqui só parseia o número.
  let quantidadeRecebida: number | null | undefined;
  const quantidadeRecebidaTexto = formData.has("quantidadeRecebida")
    ? String(formData.get("quantidadeRecebida") ?? "").trim()
    : undefined;
  if (quantidadeRecebidaTexto === undefined) {
    quantidadeRecebida = undefined;
  } else if (quantidadeRecebidaTexto === "") {
    quantidadeRecebida = null;
  } else {
    const numero = Number(quantidadeRecebidaTexto);
    if (!Number.isFinite(numero) || numero <= 0) {
      return { ok: false, mensagem: "Quantidade recebida inválida." };
    }
    quantidadeRecebida = numero;
  }

  const parseValorNotaFiscal = parseValorNaoNegativoOpcional("valorNotaFiscal");
  if (!parseValorNotaFiscal.ok) return { ok: false, mensagem: parseValorNotaFiscal.mensagem };

  const divergenciaObservacao = campoOpcionalTransicao(formData, "divergenciaObservacao");

  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // itemGrafica pode ser null (compra por descricaoLivre); nome exibido
  // cai pra descrição livre digitada na criação.
  const nomeItem = solicitacao.itemGrafica
    ? `${solicitacao.itemGrafica.itemCatalogo.nome}${solicitacao.variante ? ` (${solicitacao.variante.rotulo})` : ""}`
    : (solicitacao.descricaoLivre ?? "Compra avulsa");

  const solicitacaoParaTransicao: SolicitacaoParaTransicao = {
    id: solicitacao.id,
    graficaId: solicitacao.graficaId,
    status: solicitacao.status,
    itemGraficaId: solicitacao.itemGraficaId,
    varianteId: solicitacao.varianteId,
    quantidade: solicitacao.quantidade,
    valorEstimado: solicitacao.valorEstimado,
    valorFinal: solicitacao.valorFinal,
    fornecedorId: solicitacao.fornecedorId,
    documento: solicitacao.documento,
    pedidoId: solicitacao.pedidoId,
    contratoFornecimentoId: solicitacao.contratoFornecimentoId,
    tipoCompra: solicitacao.tipoCompra,
    valorFrete: solicitacao.valorFrete,
    valorIpi: solicitacao.valorIpi,
    valorIcmsCreditavel: solicitacao.valorIcmsCreditavel,
    valorDesconto: solicitacao.valorDesconto,
    quantidadeRecebida: solicitacao.quantidadeRecebida,
  };

  const resultado = await avancarStatusCompra(
    solicitacaoParaTransicao,
    proximoStatus,
    { id: usuario.id, papel: usuario.papel },
    {
      fornecedorId: fornecedorIdBruto,
      documento: documentoBruto,
      valorFinal,
      valorFrete: parseFrete.valor,
      valorIpi: parseIpi.valor,
      valorIcmsCreditavel: parseIcms.valor,
      valorDesconto: parseDesconto.valor,
      quantidadeRecebida,
      valorNotaFiscal: parseValorNotaFiscal.valor,
      divergenciaObservacao,
    }
  );

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

// Status em que ainda faz sentido registrar/editar/excluir uma cotação, ou
// marcar uma vencedora — a decisão é travada a partir de APROVADO em diante
// (achado A4 da auditoria de abrangência, Parte 3/Compras): depois que a
// solicitação avança, a cotação vencedora já foi copiada pros campos da
// solicitação (ver status-transicao.ts) e reabrir cotação viraria histórico
// incoerente com o que já foi decidido.
const STATUS_PERMITE_COTACAO = new Set<StatusSolicitacaoCompra>(["SOLICITADO", "COTANDO"]);

type CarregarSolicitacaoParaCotacaoResultado =
  | { ok: true; solicitacao: Prisma.SolicitacaoCompraGetPayload<{ include: { itemGrafica: { include: { itemCatalogo: true } }; variante: true } }> }
  | { ok: false; mensagem: string };

async function carregarSolicitacaoParaCotacao(
  solicitacaoId: string,
  graficaId: string
): Promise<CarregarSolicitacaoParaCotacaoResultado> {
  const solicitacao = await prisma.solicitacaoCompra.findFirst({
    where: { id: solicitacaoId, graficaId },
    include: { itemGrafica: { include: { itemCatalogo: true } }, variante: true },
  });
  if (!solicitacao) return { ok: false, mensagem: "Solicitação não encontrada." };
  if (!STATUS_PERMITE_COTACAO.has(solicitacao.status)) {
    return {
      ok: false,
      mensagem: `Não é possível mexer em cotações com a solicitação em "${ROTULOS_STATUS_SOLICITACAO_COMPRA[solicitacao.status]}".`,
    };
  }
  return { ok: true, solicitacao };
}

export type CotacaoFornecedorResult = { ok: boolean; mensagem: string };

const registrarCotacaoSchema = z.object({
  solicitacaoId: z.string().min(1),
  fornecedorId: z.string().min(1, "Selecione um fornecedor."),
  precoUnitario: z.coerce.number().positive("Preço unitário deve ser maior que zero."),
  valorTotal: z.coerce.number().positive("Valor total deve ser maior que zero."),
  prazoEntregaDias: z.coerce.number().int().min(0).optional(),
  condicaoPagamento: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
  validaAte: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  frete: z.coerce.number().min(0).optional(),
  observacao: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

// Cria ou atualiza (upsert, ver @@unique([solicitacaoCompraId, fornecedorId])
// em CotacaoFornecedor) a cotação de um fornecedor pra esta solicitação —
// "mapa de cotação": preço, prazo de entrega e condição de pagamento lado a
// lado de cada fornecedor consultado, antes de escolher com quem comprar
// (achado A4 da auditoria de abrangência, Parte 3/Compras).
export async function registrarCotacaoFornecedor(
  _estadoAnterior: CotacaoFornecedorResult | null,
  formData: FormData
): Promise<CotacaoFornecedorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "COMPRAS"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = registrarCotacaoSchema.safeParse({
    solicitacaoId: formData.get("solicitacaoId"),
    fornecedorId: formData.get("fornecedorId"),
    precoUnitario: formData.get("precoUnitario"),
    valorTotal: formData.get("valorTotal"),
    prazoEntregaDias: formData.get("prazoEntregaDias") || undefined,
    condicaoPagamento: formData.get("condicaoPagamento") || undefined,
    validaAte: formData.get("validaAte") || undefined,
    frete: formData.get("frete") || undefined,
    observacao: formData.get("observacao") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const {
    solicitacaoId,
    fornecedorId,
    precoUnitario,
    valorTotal,
    prazoEntregaDias,
    condicaoPagamento,
    validaAte,
    frete,
    observacao,
  } = parsed.data;

  const carregado = await carregarSolicitacaoParaCotacao(solicitacaoId, usuario.graficaId);
  if (!carregado.ok) {
    return { ok: false, mensagem: carregado.mensagem };
  }
  const { solicitacao } = carregado;

  const fornecedor = await prisma.fornecedor.findFirst({
    where: { id: fornecedorId, graficaId: usuario.graficaId },
    select: { id: true, nome: true },
  });
  if (!fornecedor) {
    return { ok: false, mensagem: "Fornecedor selecionado é inválido." };
  }

  await prisma.cotacaoFornecedor.upsert({
    where: { solicitacaoCompraId_fornecedorId: { solicitacaoCompraId: solicitacaoId, fornecedorId } },
    create: {
      solicitacaoCompraId: solicitacaoId,
      fornecedorId,
      precoUnitario: precoUnitario.toFixed(4),
      valorTotal: valorTotal.toFixed(2),
      prazoEntregaDias: prazoEntregaDias ?? null,
      condicaoPagamento: condicaoPagamento ?? null,
      validaAte: validaAte ? dataInputParaUTC(validaAte) : null,
      frete: frete !== undefined ? frete.toFixed(2) : null,
      observacao: observacao ?? null,
      registradaPorId: usuario.id,
    },
    update: {
      precoUnitario: precoUnitario.toFixed(4),
      valorTotal: valorTotal.toFixed(2),
      prazoEntregaDias: prazoEntregaDias ?? null,
      condicaoPagamento: condicaoPagamento ?? null,
      validaAte: validaAte ? dataInputParaUTC(validaAte) : null,
      frete: frete !== undefined ? frete.toFixed(2) : null,
      observacao: observacao ?? null,
      registradaPorId: usuario.id,
      // Recotar um fornecedor que já era vencedor não derruba a escolha
      // automaticamente — só atualiza os números; se o preço mudou o
      // suficiente pra mudar a decisão, quem está cotando escolhe outra
      // vencedora explicitamente (ver definirCotacaoVencedora).
    },
  });

  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // itemGrafica pode ser null (compra por descricaoLivre).
  const nomeItem = solicitacao.itemGrafica
    ? `${solicitacao.itemGrafica.itemCatalogo.nome}${solicitacao.variante ? ` (${solicitacao.variante.rotulo})` : ""}`
    : (solicitacao.descricaoLivre ?? "Compra avulsa");
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "compras.cotacao_registrada",
    entidade: "SolicitacaoCompra",
    entidadeId: solicitacao.id,
    descricao: `Cotação de "${fornecedor.nome}" registrada pra "${nomeItem}" (${formatoMoeda.format(valorTotal)})`,
  });

  revalidatePath(`/compras/${solicitacaoId}`);
  return { ok: true, mensagem: `Cotação de "${fornecedor.nome}" registrada.` };
}

const definirVencedoraSchema = z.object({
  solicitacaoId: z.string().min(1),
  cotacaoId: z.string().min(1),
});

// Marca UMA cotação como vencedora e desmarca todas as outras da mesma
// solicitação, na mesma transação — nunca duas vencedoras ao mesmo tempo
// (ver comentário de CotacaoFornecedor.vencedora no schema sobre por que
// essa exclusividade é garantida em código, não em constraint de banco).
export async function definirCotacaoVencedora(
  _estadoAnterior: CotacaoFornecedorResult | null,
  formData: FormData
): Promise<CotacaoFornecedorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "COMPRAS"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = definirVencedoraSchema.safeParse({
    solicitacaoId: formData.get("solicitacaoId"),
    cotacaoId: formData.get("cotacaoId"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: "Dados inválidos." };
  }
  const { solicitacaoId, cotacaoId } = parsed.data;

  const carregado = await carregarSolicitacaoParaCotacao(solicitacaoId, usuario.graficaId);
  if (!carregado.ok) {
    return { ok: false, mensagem: carregado.mensagem };
  }

  const cotacao = await prisma.cotacaoFornecedor.findFirst({
    where: { id: cotacaoId, solicitacaoCompraId: solicitacaoId },
    include: { fornecedor: { select: { nome: true } } },
  });
  if (!cotacao) {
    return { ok: false, mensagem: "Cotação não encontrada." };
  }

  await prisma.$transaction([
    prisma.cotacaoFornecedor.updateMany({
      where: { solicitacaoCompraId: solicitacaoId, id: { not: cotacaoId } },
      data: { vencedora: false },
    }),
    prisma.cotacaoFornecedor.update({ where: { id: cotacaoId }, data: { vencedora: true } }),
  ]);

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "compras.cotacao_vencedora",
    entidade: "SolicitacaoCompra",
    entidadeId: solicitacaoId,
    descricao: `Cotação de "${cotacao.fornecedor.nome}" escolhida como vencedora`,
  });

  revalidatePath(`/compras/${solicitacaoId}`);
  return { ok: true, mensagem: `"${cotacao.fornecedor.nome}" marcada como vencedora.` };
}

const excluirCotacaoSchema = z.object({
  solicitacaoId: z.string().min(1),
  cotacaoId: z.string().min(1),
});

// Remove uma cotação registrada por engano — só permitido enquanto a
// decisão ainda não foi travada (ver STATUS_PERMITE_COTACAO). Se a cotação
// removida era a vencedora, a solicitação simplesmente volta a não ter
// vencedora nenhuma (avancarStatusCompra vai barrar a aprovação até alguém
// marcar outra).
export async function excluirCotacaoFornecedor(
  _estadoAnterior: CotacaoFornecedorResult | null,
  formData: FormData
): Promise<CotacaoFornecedorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "COMPRAS"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const parsed = excluirCotacaoSchema.safeParse({
    solicitacaoId: formData.get("solicitacaoId"),
    cotacaoId: formData.get("cotacaoId"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: "Dados inválidos." };
  }
  const { solicitacaoId, cotacaoId } = parsed.data;

  const carregado = await carregarSolicitacaoParaCotacao(solicitacaoId, usuario.graficaId);
  if (!carregado.ok) {
    return { ok: false, mensagem: carregado.mensagem };
  }

  const cotacao = await prisma.cotacaoFornecedor.findFirst({
    where: { id: cotacaoId, solicitacaoCompraId: solicitacaoId },
    include: { fornecedor: { select: { nome: true } } },
  });
  if (!cotacao) {
    return { ok: false, mensagem: "Cotação não encontrada." };
  }

  await prisma.cotacaoFornecedor.delete({ where: { id: cotacaoId } });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "compras.cotacao_excluida",
    entidade: "SolicitacaoCompra",
    entidadeId: solicitacaoId,
    descricao: `Cotação de "${cotacao.fornecedor.nome}" excluída`,
  });

  revalidatePath(`/compras/${solicitacaoId}`);
  return { ok: true, mensagem: `Cotação de "${cotacao.fornecedor.nome}" excluída.` };
}
