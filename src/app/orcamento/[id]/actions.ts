"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { calcularItemOrcamento } from "@/lib/orcamento-precificacao";
import { resolverOrigemPublica } from "@/lib/url-publica";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_ORCAMENTO,
  type StatusOrcamento,
} from "@/lib/orcamento-status";
import { verificarProntidaoFiscal } from "@/lib/nota-fiscal";
import { emitirNfe, consultarNfe, ErroFocusNfe, type AmbienteFocusNfe } from "@/lib/focus-nfe";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { dataInputParaUTC } from "@/lib/data";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { calcularValorBase, calcularComissao } from "@/lib/comissao";

// Sinaliza, de dentro de uma transação Serializable, que o orçamento já está
// no último item — usado só pra abortar a transação com uma mensagem amigável
// (ver removerItemOrcamento). Não é um erro de banco de verdade.
class ErroUltimoItemOrcamento extends Error {}

const MENSAGEM_CONFLITO_CONCORRENTE =
  "Outra pessoa alterou este orçamento ao mesmo tempo — tente de novo.";

export type AtualizarStatusResult = { ok: boolean; mensagem: string };

export async function atualizarStatusOrcamento(
  _estadoAnterior: AtualizarStatusResult | null,
  formData: FormData
): Promise<AtualizarStatusResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
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
    // Opcional: string vazia (campo em branco) vira undefined, pedido nasce
    // sem prazo e nunca vai gerar alerta de atraso (ver src/lib/alerta-atraso.ts).
    const prazoEntregaBruto = formData.get("prazoEntrega");
    const prazoEntrega =
      typeof prazoEntregaBruto === "string" && prazoEntregaBruto
        ? dataInputParaUTC(prazoEntregaBruto)
        : undefined;

    // Leitura fora da transação de propósito (mesmo cuidado de avancarPedido
    // em src/app/producao/actions.ts): ficha de custo/comissão não muda por
    // causa de uma corrida de atualizarStatusOrcamento, então não precisa
    // fazer parte da transação — mantém ela curta.
    const [orcamentoComItens, usuarioVendedor, parametros] = await Promise.all([
      prisma.orcamentoItem.findMany({
        where: { orcamentoId },
        include: { itemGrafica: { select: { precoCompra: true } } },
      }),
      prisma.usuario.findUnique({
        where: { id: orcamento.usuarioId },
        select: { comissaoPercent: true },
      }),
      prisma.parametrosGrafica.findUnique({
        where: { graficaId: usuario.graficaId },
        select: { comissaoVendedorBase: true },
      }),
    ]);

    // upsert (não create): idempotente contra duplo submit/duplo clique,
    // já que orcamentoId é único em Pedido (e em Comissao).
    const operacoes: Prisma.PrismaPromise<unknown>[] = [
      prisma.orcamento.update({
        where: { id: orcamentoId },
        data: { status: "APROVADO" },
      }),
      prisma.pedido.upsert({
        where: { orcamentoId },
        update: {},
        create: { graficaId: usuario.graficaId, orcamentoId, status: "FILA", prazoEntrega },
      }),
    ];

    const percentualVendedor = usuarioVendedor?.comissaoPercent
      ? Number(usuarioVendedor.comissaoPercent)
      : null;
    if (percentualVendedor && percentualVendedor > 0) {
      const baseCalculo = parametros?.comissaoVendedorBase ?? "VALOR";
      // Custo real só existe no motor avançado (breakdown.custoTotal, ver
      // src/lib/pricing/compor.ts) — item SIMPLES usa o preço de compra
      // ATUAL do produto como estimativa (não é snapshot do momento da
      // venda; pode ter mudado desde a criação do orçamento). Sem
      // precoCompra cadastrado, custo 0 pra esse item (conta como lucro
      // total em vez de travar o cálculo).
      const itensComCusto = orcamentoComItens.map((item) => {
        const breakdown = item.breakdown as { custoTotal?: string } | null;
        const custoTotal = breakdown?.custoTotal
          ? Number(breakdown.custoTotal)
          : item.itemGrafica.precoCompra
            ? Number(item.itemGrafica.precoCompra) * item.quantidade
            : 0;
        return { precoTotal: Number(item.precoTotal), custoTotal };
      });
      const valorBase = calcularValorBase(Number(orcamento.total), itensComCusto, baseCalculo);
      const valorComissao = calcularComissao(valorBase, percentualVendedor);

      operacoes.push(
        prisma.comissao.upsert({
          where: { orcamentoId },
          update: {},
          create: {
            graficaId: usuario.graficaId,
            orcamentoId,
            usuarioId: orcamento.usuarioId,
            baseCalculo,
            percentualAplicado: percentualVendedor,
            valorBase,
            valorComissao,
          },
        })
      );
    }

    await prisma.$transaction(operacoes);
  } else {
    await prisma.orcamento.update({
      where: { id: orcamentoId },
      data: { status: novoStatus },
    });
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");
  if (novoStatus === "APROVADO") {
    revalidatePath("/producao");
    revalidatePath("/financeiro/comissoes");
  }

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
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
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

  // Isolamento Serializable + total recalculado por agregado DENTRO da
  // transação (não somado em JS a partir da leitura de `orcamento.itens` feita
  // acima, que já pode estar desatualizada) — evita tanto a corrida de duas
  // edições concorrentes em itens diferentes do mesmo orçamento quanto a
  // imprecisão de somar Decimal via Number() (o SUM roda no Postgres).
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.orcamentoItem.update({
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
        });
        const agregado = await tx.orcamentoItem.aggregate({
          where: { orcamentoId },
          _sum: { precoTotal: true },
        });
        await tx.orcamento.update({
          where: { id: orcamentoId },
          data: { total: agregado._sum.precoTotal ?? 0 },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

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
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
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
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
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

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.orcamentoItem.create({
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
        });
        const agregado = await tx.orcamentoItem.aggregate({
          where: { orcamentoId },
          _sum: { precoTotal: true },
        });
        await tx.orcamento.update({
          where: { id: orcamentoId },
          data: { total: agregado._sum.precoTotal ?? 0 },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

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
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoItemId = String(formData.get("orcamentoItemId"));

  const item = await prisma.orcamentoItem.findFirst({
    where: { id: orcamentoItemId, orcamento: { graficaId: usuario.graficaId } },
    include: { orcamento: true },
  });
  if (!item) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  if (item.orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível remover itens de um orçamento em rascunho." };
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        // Contagem refeita AQUI DENTRO (não a partir de uma leitura solta) —
        // sob Serializable, duas remoções concorrentes no mesmo orçamento não
        // conseguem as duas passar por essa checagem: uma é abortada com
        // conflito de serialização (ver catch abaixo).
        const quantidadeItens = await tx.orcamentoItem.count({
          where: { orcamentoId: item.orcamentoId },
        });
        if (quantidadeItens <= 1) {
          throw new ErroUltimoItemOrcamento();
        }

        await tx.orcamentoItem.delete({ where: { id: orcamentoItemId } });

        const agregado = await tx.orcamentoItem.aggregate({
          where: { orcamentoId: item.orcamentoId },
          _sum: { precoTotal: true },
        });
        await tx.orcamento.update({
          where: { id: item.orcamentoId },
          data: { total: agregado._sum.precoTotal ?? 0 },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (erro instanceof ErroUltimoItemOrcamento) {
      return {
        ok: false,
        mensagem:
          "O orçamento precisa ter pelo menos um item — cancele o orçamento se quiser removê-lo por completo.",
      };
    }
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

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
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
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
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
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

  const url = `${await resolverOrigemPublica()}/o/${token}`;

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
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
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

  const pagamento = await prisma.pagamento.create({
    data: { orcamentoId, valor, forma: formaParsed.data, observacao },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "pagamento.registrar",
    entidade: "Pagamento",
    entidadeId: pagamento.id,
    descricao: `Pagamento de ${formatoMoeda.format(valor)} (${formaParsed.data}) registrado no orçamento #${orcamentoId.slice(-6)}`,
  });

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: "Pagamento registrado com sucesso!" };
}

const UNIDADE_FISCAL: Record<string, string> = {
  FOLHA: "FL",
  METRO_QUADRADO: "M2",
  METRO_LINEAR: "M",
  UNIDADE: "UN",
  LITRO: "LT",
  KG: "KG",
  ROLO: "RL",
  PACOTE: "PCT",
  CENTO: "CT",
  HORA: "HR",
};

export type EmitirNotaFiscalResult = { ok: boolean; mensagem: string };

// Emite a nota fiscal (NF-e) do orçamento via Focus NFe — cada gráfica usa a
// PRÓPRIA conta/token (ver Configurações → Dados fiscais), nunca uma conta
// nossa. Só chega até aqui depois do usuário clicar "Emitir nota fiscal" no
// NotaFiscalCard — nada disso é pedido proativamente em /comecar ou /login.
export async function emitirNotaFiscal(
  _estadoAnterior: EmitirNotaFiscalResult | null,
  formData: FormData
): Promise<EmitirNotaFiscalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: {
      cliente: true,
      notaFiscal: true,
      itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
    },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento.status !== "APROVADO") {
    return { ok: false, mensagem: "Só é possível emitir nota fiscal de um orçamento aprovado." };
  }
  if (orcamento.notaFiscal) {
    return { ok: false, mensagem: "Este orçamento já tem uma nota fiscal emitida." };
  }

  const dadosFiscais = await prisma.dadosFiscaisGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });

  const checagem = verificarProntidaoFiscal({
    dadosFiscais,
    cliente: orcamento.cliente,
    itens: orcamento.itens.map((item) => ({
      nome: item.itemGrafica.itemCatalogo.nome,
      ncm: item.itemGrafica.itemCatalogo.ncm,
    })),
  });
  if (!checagem.pronto || !dadosFiscais) {
    return { ok: false, mensagem: checagem.pendencias.join(" ") };
  }

  try {
    const resposta = await emitirNfe(
      { token: dadosFiscais.focusNfeToken!, ambiente: dadosFiscais.ambiente as AmbienteFocusNfe },
      {
        referencia: orcamentoId,
        naturezaOperacao: dadosFiscais.naturezaOperacaoPadrao,
        emitente: {
          cnpj: dadosFiscais.cnpj!,
          nome: dadosFiscais.razaoSocial!,
          nomeFantasia: dadosFiscais.nomeFantasia || dadosFiscais.razaoSocial!,
          inscricaoEstadual: dadosFiscais.inscricaoEstadual ?? "",
          logradouro: dadosFiscais.enderecoLogradouro!,
          numero: dadosFiscais.enderecoNumero!,
          bairro: dadosFiscais.enderecoBairro!,
          municipio: dadosFiscais.enderecoMunicipio!,
          uf: dadosFiscais.enderecoUf!,
          cep: dadosFiscais.enderecoCep!,
        },
        destinatario: {
          documento: orcamento.cliente.documento!,
          nome: orcamento.cliente.nome,
          logradouro: orcamento.cliente.enderecoLogradouro!,
          numero: orcamento.cliente.enderecoNumero!,
          bairro: orcamento.cliente.enderecoBairro!,
          municipio: orcamento.cliente.enderecoMunicipio!,
          uf: orcamento.cliente.enderecoUf!,
          cep: orcamento.cliente.enderecoCep!,
        },
        itens: orcamento.itens.map((item, indice) => ({
          numeroItem: indice + 1,
          codigoProduto: item.itemGraficaId,
          descricao: item.itemGrafica.itemCatalogo.nome,
          ncm: item.itemGrafica.itemCatalogo.ncm!,
          cfop: dadosFiscais.cfopPadrao,
          unidade: UNIDADE_FISCAL[item.itemGrafica.itemCatalogo.unidade ?? "UNIDADE"] ?? "UN",
          quantidade: item.quantidade,
          valorUnitario: Number(item.precoUnitario),
          valorBruto: Number(item.precoTotal),
          icmsSituacaoTributaria: dadosFiscais.csosnPadrao,
        })),
        valorTotal: Number(orcamento.total),
      }
    );

    await prisma.notaFiscal.create({
      data: {
        graficaId: usuario.graficaId,
        orcamentoId,
        referencia: orcamentoId,
        status:
          resposta.status === "autorizado"
            ? "AUTORIZADA"
            : resposta.status === "erro_autorizacao" || resposta.status === "denegado"
              ? "REJEITADA"
              : "PROCESSANDO",
        numero: resposta.numero,
        serie: resposta.serie,
        chaveAcesso: resposta.chaveNfe,
        xmlUrl: resposta.caminhoXml,
        danfeUrl: resposta.caminhoDanfe,
        mensagemErro: resposta.mensagemErro ?? resposta.mensagemSefaz,
      },
    });
  } catch (erro) {
    if (erro instanceof ErroFocusNfe) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Nota fiscal enviada pra processamento!" };
}

export async function atualizarStatusNotaFiscal(
  _estadoAnterior: EmitirNotaFiscalResult | null,
  formData: FormData
): Promise<EmitirNotaFiscalResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const orcamentoId = String(formData.get("orcamentoId"));

  const notaFiscal = await prisma.notaFiscal.findFirst({
    where: { orcamentoId, graficaId: usuario.graficaId },
  });
  if (!notaFiscal) {
    return { ok: false, mensagem: "Nota fiscal não encontrada." };
  }

  const dadosFiscais = await prisma.dadosFiscaisGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
  });
  if (!dadosFiscais?.focusNfeToken) {
    return { ok: false, mensagem: "Token da Focus NFe não configurado." };
  }

  try {
    const resposta = await consultarNfe(
      { token: dadosFiscais.focusNfeToken, ambiente: dadosFiscais.ambiente as AmbienteFocusNfe },
      notaFiscal.referencia
    );

    await prisma.notaFiscal.update({
      where: { id: notaFiscal.id },
      data: {
        status:
          resposta.status === "autorizado"
            ? "AUTORIZADA"
            : resposta.status === "cancelado"
              ? "CANCELADA"
              : resposta.status === "erro_autorizacao" || resposta.status === "denegado"
                ? "REJEITADA"
                : "PROCESSANDO",
        numero: resposta.numero,
        serie: resposta.serie,
        chaveAcesso: resposta.chaveNfe,
        xmlUrl: resposta.caminhoXml,
        danfeUrl: resposta.caminhoDanfe,
        mensagemErro: resposta.mensagemErro ?? resposta.mensagemSefaz,
      },
    });
  } catch (erro) {
    if (erro instanceof ErroFocusNfe) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  return { ok: true, mensagem: "Status atualizado." };
}

export async function excluirPagamento(
  _estadoAnterior: RegistrarPagamentoResult | null,
  formData: FormData
): Promise<RegistrarPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }
  const pagamentoId = String(formData.get("pagamentoId"));

  const pagamento = await prisma.pagamento.findFirst({
    where: { id: pagamentoId, orcamento: { graficaId: usuario.graficaId } },
  });
  if (!pagamento) {
    return { ok: false, mensagem: "Pagamento não encontrado." };
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "pagamento.excluir",
    entidade: "Pagamento",
    entidadeId: pagamento.id,
    descricao: `Pagamento de ${formatoMoeda.format(Number(pagamento.valor))} removido do orçamento #${pagamento.orcamentoId.slice(-6)}`,
  });

  await prisma.pagamento.delete({ where: { id: pagamento.id } });

  revalidatePath(`/orcamento/${pagamento.orcamentoId}`);
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: "Pagamento removido." };
}
