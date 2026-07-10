"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { calcularItemOrcamento } from "@/lib/orcamento-precificacao";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_ORCAMENTO,
  type StatusOrcamento,
} from "@/lib/orcamento-status";

export type AtualizarStatusResult = { ok: boolean; mensagem: string };

export async function atualizarStatusOrcamento(
  _estadoAnterior: AtualizarStatusResult | null,
  formData: FormData
): Promise<AtualizarStatusResult> {
  const usuario = await exigirUsuarioAutenticado();
  const orcamentoId = String(formData.get("orcamentoId"));
  const novoStatus = String(formData.get("novoStatus")) as StatusOrcamento;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  const transicaoPermitida = TRANSICOES_VALIDAS[
    orcamento.status as StatusOrcamento
  ]?.includes(novoStatus);
  if (!transicaoPermitida) {
    return { ok: false, mensagem: "Transição de status inválida." };
  }

  if (novoStatus === "APROVADO") {
    // upsert (não create): idempotente contra duplo submit/duplo clique,
    // já que orcamentoId é único em Pedido.
    await prisma.$transaction([
      prisma.orcamento.update({
        where: { id: orcamentoId },
        data: { status: "APROVADO" },
      }),
      prisma.pedido.upsert({
        where: { orcamentoId },
        update: {},
        create: { graficaId: usuario.graficaId, orcamentoId, status: "FILA" },
      }),
    ]);
  } else {
    await prisma.orcamento.update({
      where: { id: orcamentoId },
      data: { status: novoStatus },
    });
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");
  if (novoStatus === "APROVADO") revalidatePath("/producao");

  return {
    ok: true,
    mensagem: `Orçamento atualizado para ${ROTULOS_STATUS_ORCAMENTO[novoStatus]}.`,
  };
}

export type EditarOrcamentoResult = { ok: boolean; mensagem: string };

// Edita UM item específico do orçamento (não mais "o item", já que um orçamento
// pode ter vários — ver plano de multi-item). O total do orçamento é sempre
// recalculado como soma de TODOS os itens, não só do editado.
export async function editarOrcamento(
  _estadoAnterior: EditarOrcamentoResult | null,
  formData: FormData
): Promise<EditarOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  const orcamentoId = String(formData.get("orcamentoId"));
  const orcamentoItemId = String(formData.get("orcamentoItemId"));
  const quantidade = Number(formData.get("quantidade"));
  const larguraCm = formData.get("larguraCm") ? Number(formData.get("larguraCm")) : null;
  const alturaCm = formData.get("alturaCm") ? Number(formData.get("alturaCm")) : null;
  const cores = String(formData.get("cores") || "");
  const acabamento = String(formData.get("acabamento") || "");
  const corFrente = formData.get("corFrente") ? Number(formData.get("corFrente")) : null;
  const corVerso = formData.get("corVerso") ? Number(formData.get("corVerso")) : null;

  if (!quantidade || quantidade <= 0) {
    return { ok: false, mensagem: "Informe uma quantidade válida." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: { itens: { include: { itemGrafica: true } } },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  // Só dá pra editar enquanto ainda é rascunho — preserva a integridade do
  // que já foi enviado/decidido pelo cliente.
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível editar um orçamento em rascunho." };
  }

  const item = orcamento.itens.find((i) => i.id === orcamentoItemId);
  if (!item) {
    return { ok: false, mensagem: "Item do orçamento não encontrado." };
  }

  const resultado = await calcularItemOrcamento(item.itemGrafica, usuario.graficaId, {
    quantidade,
    larguraCm,
    alturaCm,
    corFrente,
    corVerso,
  });
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  // TODO(review): `orcamento.itens` foi lido ANTES desta transação — duas edições
  // concorrentes em itens diferentes do mesmo orçamento (duas abas, por exemplo)
  // calculam `novoTotal` cada uma com a visão antiga do item alheio, e a
  // transação que commitar por último sobrescreve o total da outra (lost
  // update). Pra ser realmente seguro, `novoTotal` precisaria ser recalculado
  // dentro da transação (SELECT ... FOR UPDATE, ou um agregado feito pelo
  // próprio Postgres) em vez de somado em JS a partir de uma leitura solta.
  // Mesmo padrão se repete em adicionarItemOrcamento e removerItemOrcamento
  // logo abaixo.
  const novoTotal = orcamento.itens.reduce(
    (soma, i) =>
      soma + (i.id === orcamentoItemId ? Number(resultado.precoTotal) : Number(i.precoTotal)),
    0
  );

  await prisma.$transaction([
    prisma.orcamentoItem.update({
      where: { id: orcamentoItemId },
      data: {
        quantidade,
        larguraCm,
        alturaCm,
        cores: cores || null,
        acabamento: acabamento || null,
        precoUnitario: resultado.precoUnitario,
        precoTotal: resultado.precoTotal,
        corFrente: resultado.corFrente,
        corVerso: resultado.corVerso,
        breakdown: resultado.breakdown ?? undefined,
      },
    }),
    prisma.orcamento.update({
      where: { id: orcamentoId },
      data: { total: novoTotal },
    }),
  ]);

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Item atualizado com sucesso!" };
}

export type AlterarClienteResult = { ok: boolean; mensagem: string };

export async function alterarClienteOrcamento(
  _estadoAnterior: AlterarClienteResult | null,
  formData: FormData
): Promise<AlterarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  const orcamentoId = String(formData.get("orcamentoId"));
  const clienteId = String(formData.get("clienteId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível trocar o cliente de um orçamento em rascunho." };
  }

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  await prisma.orcamento.update({
    where: { id: orcamentoId },
    data: { clienteId: cliente.id },
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Cliente atualizado." };
}

export type AdicionarItemResult = { ok: boolean; mensagem: string };

export async function adicionarItemOrcamento(
  _estadoAnterior: AdicionarItemResult | null,
  formData: FormData
): Promise<AdicionarItemResult> {
  const usuario = await exigirUsuarioAutenticado();
  const orcamentoId = String(formData.get("orcamentoId"));
  const itemGraficaId = String(formData.get("itemGraficaId"));
  const quantidade = Number(formData.get("quantidade"));
  const larguraCm = formData.get("larguraCm") ? Number(formData.get("larguraCm")) : null;
  const alturaCm = formData.get("alturaCm") ? Number(formData.get("alturaCm")) : null;
  const cores = String(formData.get("cores") || "");
  const acabamento = String(formData.get("acabamento") || "");
  const corFrente = formData.get("corFrente") ? Number(formData.get("corFrente")) : null;
  const corVerso = formData.get("corVerso") ? Number(formData.get("corVerso")) : null;

  if (!itemGraficaId || !quantidade || quantidade <= 0) {
    return { ok: false, mensagem: "Escolha um produto e uma quantidade válida." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: { itens: true },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível adicionar itens a um orçamento em rascunho." };
  }

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: {
      id: itemGraficaId,
      graficaId: usuario.graficaId,
      ativo: true,
      precoVenda: { not: null },
    },
  });
  if (!itemGrafica || !itemGrafica.precoVenda) {
    return { ok: false, mensagem: "Produto ou serviço não encontrado." };
  }

  const resultado = await calcularItemOrcamento(itemGrafica, usuario.graficaId, {
    quantidade,
    larguraCm,
    alturaCm,
    corFrente,
    corVerso,
  });
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  const novoTotal =
    orcamento.itens.reduce((soma, i) => soma + Number(i.precoTotal), 0) +
    Number(resultado.precoTotal);

  await prisma.$transaction([
    prisma.orcamentoItem.create({
      data: {
        orcamentoId,
        itemGraficaId: itemGrafica.id,
        quantidade,
        larguraCm,
        alturaCm,
        cores: cores || null,
        acabamento: acabamento || null,
        precoUnitario: resultado.precoUnitario,
        precoTotal: resultado.precoTotal,
        modeloCalculo: resultado.modeloCalculo,
        corFrente: resultado.corFrente,
        corVerso: resultado.corVerso,
        breakdown: resultado.breakdown ?? undefined,
      },
    }),
    prisma.orcamento.update({
      where: { id: orcamentoId },
      data: { total: novoTotal },
    }),
  ]);

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Item adicionado com sucesso!" };
}

export type RemoverItemResult = { ok: boolean; mensagem: string };

export async function removerItemOrcamento(
  _estadoAnterior: RemoverItemResult | null,
  formData: FormData
): Promise<RemoverItemResult> {
  const usuario = await exigirUsuarioAutenticado();
  const orcamentoItemId = String(formData.get("orcamentoItemId"));

  const item = await prisma.orcamentoItem.findFirst({
    where: { id: orcamentoItemId, orcamento: { graficaId: usuario.graficaId } },
    include: { orcamento: { include: { itens: true } } },
  });
  if (!item) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  if (item.orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível remover itens de um orçamento em rascunho." };
  }
  // TODO(review): checagem "precisa ter pelo menos 1 item" não é atômica com o
  // delete abaixo (check-then-act sobre uma leitura solta) — duas remoções
  // concorrentes no mesmo orçamento (duplo clique, duas abas) podem cada uma
  // ver itens.length===2, passar aqui, e as duas transações completarem,
  // zerando os itens do orçamento e violando essa invariante. Precisaria de um
  // lock/checagem dentro da própria transação pra ser à prova de corrida.
  if (item.orcamento.itens.length <= 1) {
    return {
      ok: false,
      mensagem:
        "O orçamento precisa ter pelo menos um item — cancele o orçamento se quiser removê-lo por completo.",
    };
  }

  const novoTotal = item.orcamento.itens
    .filter((i) => i.id !== orcamentoItemId)
    .reduce((soma, i) => soma + Number(i.precoTotal), 0);

  await prisma.$transaction([
    prisma.orcamentoItem.delete({ where: { id: orcamentoItemId } }),
    prisma.orcamento.update({
      where: { id: item.orcamentoId },
      data: { total: novoTotal },
    }),
  ]);

  revalidatePath(`/orcamento/${item.orcamentoId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Item removido." };
}

export type CancelarOrcamentoResult = { ok: boolean; mensagem: string };

export async function cancelarOrcamento(
  _estadoAnterior: CancelarOrcamentoResult | null,
  formData: FormData
): Promise<CancelarOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível cancelar um orçamento em rascunho." };
  }

  // Hard delete: nada foi comunicado ao cliente ainda (rascunho), então não há
  // necessidade de manter um registro "cancelado" — cascade cuida do OrcamentoItem.
  await prisma.orcamento.delete({ where: { id: orcamentoId } });

  revalidatePath("/orcamento");
  redirect("/orcamento");
}

export type GerarLinkResult = { ok: boolean; mensagem: string; url?: string };

export async function gerarLinkPublico(
  _estadoAnterior: GerarLinkResult | null,
  formData: FormData
): Promise<GerarLinkResult> {
  const usuario = await exigirUsuarioAutenticado();
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  let token = orcamento.linkPublicoToken;
  if (!token) {
    token = randomBytes(20).toString("base64url");
    await prisma.orcamento.update({
      where: { id: orcamentoId },
      data: { linkPublicoToken: token },
    });
  }

  // TODO(review): essa mesma lógica de resolver proto/host dos headers e montar
  // `${proto}://${host}/o/${token}` está duplicada em
  // src/app/orcamento/[id]/page.tsx (cálculo de `origem` pro linkExistente) —
  // uma correção no fallback (ex: proxy que não seta x-forwarded-proto) precisa
  // ser replicada nos dois lugares manualmente. Valeria um helper compartilhado
  // tipo `resolverOrigemPublica()`.
  const headerList = await headers();
  const host = headerList.get("host");
  const proto =
    headerList.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const url = `${proto}://${host}/o/${token}`;

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Link gerado!", url };
}

const formaPagamentoSchema = z.enum([
  "DINHEIRO",
  "PIX",
  "CARTAO",
  "BOLETO",
  "TRANSFERENCIA",
  "OUTRO",
]);

export type RegistrarPagamentoResult = { ok: boolean; mensagem: string };

// Só permite registrar pagamento com o orçamento APROVADO — não faz sentido cobrar por
// algo que o cliente ainda não aceitou, e REJEITADO é estado terminal permanente
// (nunca é deletado, diferente de RASCUNHO). Sem bloqueio de valor: saldo devedor pode
// ficar negativo (cliente pagou a mais), é só informativo.
export async function registrarPagamento(
  _estadoAnterior: RegistrarPagamentoResult | null,
  formData: FormData
): Promise<RegistrarPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  const orcamentoId = String(formData.get("orcamentoId"));
  const valor = Number(formData.get("valor"));
  const formaParsed = formaPagamentoSchema.safeParse(formData.get("forma"));
  const observacao = String(formData.get("observacao") || "").trim() || null;

  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, mensagem: "Informe um valor maior que zero." };
  }
  if (!formaParsed.success) {
    return { ok: false, mensagem: "Forma de pagamento inválida." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "APROVADO") {
    return {
      ok: false,
      mensagem: "Só é possível registrar pagamento em um orçamento aprovado.",
    };
  }

  await prisma.pagamento.create({
    data: { orcamentoId, valor, forma: formaParsed.data, observacao },
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: "Pagamento registrado com sucesso!" };
}

export async function excluirPagamento(
  _estadoAnterior: RegistrarPagamentoResult | null,
  formData: FormData
): Promise<RegistrarPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  const pagamentoId = String(formData.get("pagamentoId"));

  const pagamento = await prisma.pagamento.findFirst({
    where: { id: pagamentoId, orcamento: { graficaId: usuario.graficaId } },
  });
  if (!pagamento) {
    return { ok: false, mensagem: "Pagamento não encontrado." };
  }

  await prisma.pagamento.delete({ where: { id: pagamento.id } });

  revalidatePath(`/orcamento/${pagamento.orcamentoId}`);
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: "Pagamento removido." };
}
