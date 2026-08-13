"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { TRANSICOES_VALIDAS, type StatusOrcamento } from "@/lib/orcamento-status";
import { calcularValorBase, calcularComissao } from "@/lib/comissao";
import { tentarRegistrarRespostaOrcamento } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";

export type ResponderPublicoResult = { ok: boolean; mensagem: string };

// Sem autenticação: o próprio token é o "credencial" — dá acesso de leitura/decisão
// só sobre ESTE orçamento, nunca sobre a conta da gráfica.
export async function responderOrcamentoPublico(
  _estadoAnterior: ResponderPublicoResult | null,
  formData: FormData
): Promise<ResponderPublicoResult> {
  const token = String(formData.get("token"));
  const decisao = String(formData.get("decisao"));

  if (decisao !== "APROVADO" && decisao !== "REJEITADO") {
    return { ok: false, mensagem: "Ação inválida." };
  }

  const orcamento = await prisma.orcamento.findUnique({
    where: { linkPublicoToken: token },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }

  // Rate limit: quem tem o link consegue chamar esta action indefinidamente —
  // sem trava, um script poderia martelar aprovação/rejeição sem limite.
  // Mesmo padrão de responderArtePublica (src/app/a/[token]/actions.ts) e
  // confirmarEstagioPublico (src/app/p/[token]/actions.ts), tabela própria
  // (TentativaRespostaOrcamento) pra não misturar o orçamento de tentativas
  // dos três fluxos públicos por token.
  const ip = await obterIpRequisicao();
  let bloqueado: boolean;
  try {
    bloqueado = await tentarRegistrarRespostaOrcamento(orcamento.id, ip);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      bloqueado = true;
    } else {
      throw erro;
    }
  }
  if (bloqueado) {
    return { ok: false, mensagem: "Muitas tentativas — aguarde alguns minutos e tente de novo." };
  }

  // Mesma máquina de estados da action autenticada — o cliente só pode decidir
  // a partir de ENVIADO, nunca "enviar" o próprio orçamento.
  const permitido = TRANSICOES_VALIDAS[orcamento.status as StatusOrcamento]?.includes(
    decisao as StatusOrcamento
  );
  if (!permitido) {
    return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
  }

  // Compare-and-swap: o updateMany só transiciona se o status AINDA for o que
  // acabamos de validar. Sem isso, o cliente aprovando pelo link público e um
  // funcionário rejeitando no painel ao mesmo tempo poderiam ambos passar na
  // checagem de transição e o último a gravar venceria — deixando, por
  // exemplo, um Pedido criado mas o orçamento marcado como REJEITADO (mesmo
  // padrão de guarda que producao/actions.ts já usa em avancarPedido).
  if (decisao === "APROVADO") {
    // Leitura fora da transação de propósito (mesmo cuidado de
    // atualizarStatusOrcamento em src/app/orcamento/[id]/actions.ts): ficha de
    // custo/comissão não muda por causa de uma corrida de
    // responderOrcamentoPublico, então não precisa fazer parte da transação —
    // mantém ela curta. Sem usuário autenticado aqui (link público), o
    // vendedor vem de orcamento.usuarioId e os parâmetros da própria gráfica
    // do orçamento.
    const [orcamentoComItens, usuarioVendedor, parametros] = await Promise.all([
      prisma.orcamentoItem.findMany({
        where: { orcamentoId: orcamento.id },
        include: { itemGrafica: { select: { precoCompra: true } } },
      }),
      prisma.usuario.findUnique({
        where: { id: orcamento.usuarioId },
        select: { comissaoPercent: true },
      }),
      prisma.parametrosGrafica.findUnique({
        where: { graficaId: orcamento.graficaId },
        select: { comissaoVendedorBase: true },
      }),
    ]);

    const percentualVendedor = usuarioVendedor?.comissaoPercent
      ? Number(usuarioVendedor.comissaoPercent)
      : null;
    const dadosComissao =
      percentualVendedor && percentualVendedor > 0
        ? (() => {
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
            return { baseCalculo, valorBase, valorComissao };
          })()
        : null;

    const resultado = await prisma.$transaction(async (tx) => {
      const cas = await tx.orcamento.updateMany({
        where: { id: orcamento.id, status: orcamento.status },
        data: { status: "APROVADO" },
      });
      if (cas.count === 0) return false;
      await tx.pedido.upsert({
        where: { orcamentoId: orcamento.id },
        update: {},
        create: {
          graficaId: orcamento.graficaId,
          orcamentoId: orcamento.id,
          status: "FILA",
          producaoLinkToken: randomBytes(20).toString("base64url"),
        },
      });

      if (dadosComissao) {
        await tx.comissao.upsert({
          where: { orcamentoId: orcamento.id },
          update: {},
          create: {
            graficaId: orcamento.graficaId,
            orcamentoId: orcamento.id,
            usuarioId: orcamento.usuarioId,
            baseCalculo: dadosComissao.baseCalculo,
            percentualAplicado: percentualVendedor!,
            valorBase: dadosComissao.valorBase,
            valorComissao: dadosComissao.valorComissao,
          },
        });
      }
      return true;
    });
    if (!resultado) {
      return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
    }
  } else {
    const cas = await prisma.orcamento.updateMany({
      where: { id: orcamento.id, status: orcamento.status },
      data: { status: "REJEITADO" },
    });
    if (cas.count === 0) {
      return { ok: false, mensagem: "Este orçamento não pode mais ser respondido." };
    }
  }

  revalidatePath(`/o/${token}`);
  revalidatePath(`/orcamento/${orcamento.id}`);
  revalidatePath("/orcamento");
  if (decisao === "APROVADO") {
    revalidatePath("/producao");
    revalidatePath("/financeiro/comissoes");
  }

  return {
    ok: true,
    mensagem: decisao === "APROVADO" ? "Orçamento aprovado!" : "Orçamento recusado.",
  };
}
