import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { D } from "@/lib/pricing/decimal";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_SOLICITACAO_COMPRA,
  type StatusSolicitacaoCompra,
} from "@/lib/compras-status";

// Núcleo da transição de status de uma SolicitacaoCompra — mesma filosofia
// de avancarStatusPedido (src/app/producao/status-transicao.ts): não faz
// autenticação/autorização (isso é responsabilidade de quem chama, ver
// src/app/compras/actions.ts), só valida a transição em si e aplica os
// efeitos colaterais de cada etapa.

export type SolicitacaoParaTransicao = {
  id: string;
  graficaId: string;
  status: StatusSolicitacaoCompra;
  itemGraficaId: string;
  varianteId: string | null;
  quantidade: Prisma.Decimal;
  valorFinal: Prisma.Decimal | null;
  fornecedorId: string | null;
  documento: string | null;
};

// Campos opcionais que o formulário de transição pode enviar junto — cada
// um só é relevante em algumas etapas (fornecedor normalmente entra em
// APROVADO, valorFinal é OBRIGATÓRIO em COMPRADO, documento costuma vir em
// COMPRADO ou RECEBIDO junto da nota fiscal), mas a função aceita qualquer
// combinação e só usa o que fizer sentido pro `proximoStatus` pedido.
// `undefined` = "não mexer nesse campo"; `null` explícito = "limpar".
export type DadosTransicaoCompra = {
  fornecedorId?: string | null;
  valorFinal?: number | null;
  documento?: string | null;
};

export type AvancarStatusCompraResult =
  | {
      ok: true;
      mensagem: string;
      statusAnterior: StatusSolicitacaoCompra;
      proximoStatus: StatusSolicitacaoCompra;
    }
  | { ok: false; mensagem: string };

// Sinaliza, de dentro da transação, que o status já mudou entre a leitura
// inicial e a escrita (duplo clique, duas abas) — mesmo papel de
// ErroPedidoJaAvancado em producao/status-transicao.ts.
class ErroSolicitacaoJaAlterada extends Error {}

// Distinta do conflito de status acima: sinaliza que o ESTOQUE do material
// mudou entre a leitura (fora da transação) e a escrita (dentro dela) —
// outra operação (produção baixando estoque, um ajuste manual) mexeu no
// mesmo material físico ao mesmo tempo. Mesmo princípio de
// ErroEstoqueDivergente em src/app/catalogo/[itemGraficaId]/actions.ts.
class ErroEstoqueDivergenteCompra extends Error {}

const MENSAGEM_CONFLITO_STATUS =
  "Outra pessoa já alterou esta solicitação — recarregue a página e confira o status atual.";

const MENSAGEM_CONFLITO_ESTOQUE =
  "O estoque deste material mudou ao mesmo tempo (outra operação em produção ou catálogo) — tente novamente.";

// Qual campo de data corresponde a cada status — preenchido pela transição
// que ENTRA nesse status (nunca retroativo). SOLICITADO fica de fora: nasce
// preenchido pelo default do schema (solicitadoEm), nunca é alcançado por
// uma transição.
const CAMPO_DATA_POR_STATUS: Partial<Record<StatusSolicitacaoCompra, string>> = {
  COTANDO: "cotandoEm",
  APROVADO: "aprovadoEm",
  COMPRADO: "compradoEm",
  RECEBIDO: "recebidoEm",
  CONFERIDO: "conferidoEm",
  CANCELADO: "canceladoEm",
};

export async function avancarStatusCompra(
  solicitacao: SolicitacaoParaTransicao,
  proximoStatus: StatusSolicitacaoCompra,
  usuario: { id: string },
  dados: DadosTransicaoCompra = {}
): Promise<AvancarStatusCompraResult> {
  const statusAnterior = solicitacao.status;

  if (!TRANSICOES_VALIDAS[statusAnterior].includes(proximoStatus)) {
    return {
      ok: false,
      mensagem: `Não é possível mudar de "${ROTULOS_STATUS_SOLICITACAO_COMPRA[statusAnterior]}" para "${ROTULOS_STATUS_SOLICITACAO_COMPRA[proximoStatus]}".`,
    };
  }

  const fornecedorIdFinal = dados.fornecedorId !== undefined ? dados.fornecedorId : solicitacao.fornecedorId;
  const documentoFinal = dados.documento !== undefined ? dados.documento : solicitacao.documento;
  const valorFinalFinal =
    dados.valorFinal !== undefined && dados.valorFinal !== null
      ? dados.valorFinal
      : solicitacao.valorFinal !== null
        ? Number(solicitacao.valorFinal)
        : null;

  // COMPRADO precisa saber quanto foi de fato pago — é esse valor (não o
  // estimado) que vira o custo snapshotado na MovimentacaoEstoque gerada
  // quando o material chega (RECEBIDO). Sem ele, a entrada nasceria sem
  // custo (mostraria "—" pra sempre) mesmo numa compra com preço real.
  if (proximoStatus === "COMPRADO" && (valorFinalFinal === null || valorFinalFinal <= 0)) {
    return { ok: false, mensagem: "Informe o valor final pago antes de marcar como comprado." };
  }

  const dadosUpdate: Record<string, unknown> = { status: proximoStatus };
  const campoData = CAMPO_DATA_POR_STATUS[proximoStatus];
  if (campoData) dadosUpdate[campoData] = new Date();
  if (proximoStatus === "APROVADO") dadosUpdate.usuarioAprovadorId = usuario.id;
  if (dados.fornecedorId !== undefined) dadosUpdate.fornecedorId = fornecedorIdFinal;
  if (dados.documento !== undefined) dadosUpdate.documento = documentoFinal;
  if (proximoStatus === "COMPRADO") dadosUpdate.valorFinal = valorFinalFinal;

  try {
    if (proximoStatus === "RECEBIDO") {
      // Leitura do estoque atual FORA da transação (mantém a transação
      // curta, mesmo padrão de lancarEntradaCompra em
      // src/app/catalogo/[itemGraficaId]/actions.ts) — o CAS abaixo garante
      // que ninguém mexeu no estoque entre esta leitura e a escrita.
      const estoqueAnterior = solicitacao.varianteId
        ? (await prisma.varianteMateriaPrima.findUnique({
            where: { id: solicitacao.varianteId },
            select: { estoqueAtual: true },
          }))?.estoqueAtual
        : (await prisma.itemGrafica.findUnique({
            where: { id: solicitacao.itemGraficaId },
            select: { estoqueAtual: true },
          }))?.estoqueAtual;

      const quantidadeDec = new D(solicitacao.quantidade.toString());
      const novoEstoque = new D(estoqueAnterior?.toString() ?? 0).plus(quantidadeDec).toFixed(4);
      const custoUnitarioDec =
        valorFinalFinal !== null && quantidadeDec.gt(0) ? new D(valorFinalFinal).div(quantidadeDec) : null;

      await prisma.$transaction(async (tx) => {
        const casStatus = await tx.solicitacaoCompra.updateMany({
          where: { id: solicitacao.id, status: statusAnterior },
          data: dadosUpdate as Prisma.SolicitacaoCompraUpdateManyMutationInput,
        });
        if (casStatus.count === 0) throw new ErroSolicitacaoJaAlterada();

        const casEstoque = solicitacao.varianteId
          ? await tx.varianteMateriaPrima.updateMany({
              where: { id: solicitacao.varianteId, estoqueAtual: estoqueAnterior ?? null },
              data: { estoqueAtual: novoEstoque },
            })
          : await tx.itemGrafica.updateMany({
              where: { id: solicitacao.itemGraficaId, estoqueAtual: estoqueAnterior ?? null },
              data: { estoqueAtual: novoEstoque },
            });
        if (casEstoque.count === 0) throw new ErroEstoqueDivergenteCompra();

        await tx.movimentacaoEstoque.create({
          data: {
            itemGraficaId: solicitacao.itemGraficaId,
            varianteId: solicitacao.varianteId,
            solicitacaoCompraId: solicitacao.id,
            tipo: "ENTRADA_COMPRA",
            quantidade: quantidadeDec.toFixed(4),
            custoUnitario: custoUnitarioDec ? custoUnitarioDec.toFixed(4) : null,
            custoTotal: valorFinalFinal !== null ? new D(valorFinalFinal).toFixed(2) : null,
            metodoCusteio: "ULTIMA_COMPRA",
            precoReferenciaEm: new Date(),
            documento: documentoFinal,
            fornecedorId: fornecedorIdFinal,
            criadoPorId: usuario.id,
          },
        });
      });
    } else {
      const resultado = await prisma.solicitacaoCompra.updateMany({
        where: { id: solicitacao.id, status: statusAnterior },
        data: dadosUpdate as Prisma.SolicitacaoCompraUpdateManyMutationInput,
      });
      if (resultado.count === 0) throw new ErroSolicitacaoJaAlterada();
    }
  } catch (erro) {
    if (erro instanceof ErroSolicitacaoJaAlterada) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_STATUS };
    }
    if (erro instanceof ErroEstoqueDivergenteCompra) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_ESTOQUE };
    }
    throw erro;
  }

  revalidatePath("/compras");
  revalidatePath(`/compras/${solicitacao.id}`);
  revalidatePath("/catalogo");
  revalidatePath("/catalogo/estoque");

  return {
    ok: true,
    mensagem: `Avançado para "${ROTULOS_STATUS_SOLICITACAO_COMPRA[proximoStatus]}".`,
    statusAnterior,
    proximoStatus,
  };
}
