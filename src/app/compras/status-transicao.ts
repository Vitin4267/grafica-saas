import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { PapelUsuario } from "@/generated/prisma/enums";
import { D } from "@/lib/pricing/decimal";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_SOLICITACAO_COMPRA,
  type StatusSolicitacaoCompra,
} from "@/lib/compras-status";
import { criarCustoAutomaticoCompra } from "@/lib/custo-pedido";
import { resolverLimiteAprovacaoCompra } from "@/lib/alcada-aprovacao";
import { formatoMoeda } from "@/lib/moeda";

// Núcleo da transição de status de uma SolicitacaoCompra — mesma filosofia
// de avancarStatusPedido (src/app/producao/status-transicao.ts): não faz
// autenticação (isso é responsabilidade de quem chama, ver
// src/app/compras/actions.ts — exigirUsuarioAutenticado/podeEditarModulo),
// só valida a transição em si e aplica os efeitos colaterais de cada etapa.
// Exceção: a trava de ALÇADA por valor em APROVADO abaixo (achado A4 da
// auditoria de abrangência, Parte 6/Configurações) mora aqui de propósito,
// não em quem chama — é uma regra da própria transição de status, mesmo
// espírito da checagem de cotação vencedora COTANDO→APROVADO logo abaixo.

export type SolicitacaoParaTransicao = {
  id: string;
  graficaId: string;
  status: StatusSolicitacaoCompra;
  itemGraficaId: string;
  varianteId: string | null;
  quantidade: Prisma.Decimal;
  // Estimativa no momento da solicitação/cotação — usada (junto da cotação
  // vencedora, quando existe) só pra checar a alçada de quem aprova, nunca
  // pra gravar nada (ver DadosTransicaoCompra.valorFinal pra isso).
  valorEstimado: Prisma.Decimal | null;
  valorFinal: Prisma.Decimal | null;
  fornecedorId: string | null;
  documento: string | null;
  // Achado A3 da auditoria de abrangência (Parte 3/Compras) — preenchido só
  // quando origem=PEDIDO_ESPECIFICO. Ao chegar em RECEBIDO, gera o
  // CustoPedido origem=COMPRA deste pedido (ver criarCustoAutomaticoCompra).
  pedidoId: string | null;
  // Achado A9 da auditoria de abrangência (Parte 3/Compras) — preenchido só
  // quando origem=CONTRATO_PROGRAMADO. Ao chegar em RECEBIDO, incrementa
  // ContratoFornecimento.quantidadeConsumida deste contrato (ver bloco
  // RECEBIDO abaixo).
  contratoFornecimentoId: string | null;
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
  // `papel` é opcional só pra não quebrar os chamadores que já existiam
  // antes desta trava (ex: testes que chamam avancarStatusCompra direto
  // com só o id) — quando ausente, o papel do aprovador é resolvido aqui
  // dentro a partir do banco (ver bloco de alçada abaixo). Quem chama de
  // produção (src/app/compras/actions.ts) já tem `usuario.papel` em mãos e
  // sempre passa, evitando essa consulta extra.
  usuario: { id: string; papel?: PapelUsuario },
  dados: DadosTransicaoCompra = {}
): Promise<AvancarStatusCompraResult> {
  const statusAnterior = solicitacao.status;

  if (!TRANSICOES_VALIDAS[statusAnterior].includes(proximoStatus)) {
    return {
      ok: false,
      mensagem: `Não é possível mudar de "${ROTULOS_STATUS_SOLICITACAO_COMPRA[statusAnterior]}" para "${ROTULOS_STATUS_SOLICITACAO_COMPRA[proximoStatus]}".`,
    };
  }

  // COTANDO→APROVADO precisa de uma cotação vencedora escolhida (achado A4
  // da auditoria de abrangência, Parte 3/Compras) — sem isso a aprovação
  // nasceria sem nenhuma cotação de fato registrada por trás. Só se aplica
  // quando a solicitação passou por COTANDO de verdade; SOLICITADO→APROVADO
  // direto (pulando cotação, já era permitido) continua funcionando do jeito
  // que sempre funcionou, sem exigir nada disto.
  let cotacaoVencedora: { fornecedorId: string; valorTotal: Prisma.Decimal } | null = null;
  if (statusAnterior === "COTANDO" && proximoStatus === "APROVADO") {
    cotacaoVencedora = await prisma.cotacaoFornecedor.findFirst({
      where: { solicitacaoCompraId: solicitacao.id, vencedora: true },
      select: { fornecedorId: true, valorTotal: true },
    });
    if (!cotacaoVencedora) {
      return { ok: false, mensagem: "Escolha a cotação vencedora antes de aprovar esta solicitação." };
    }
  }

  // Trava de ALÇADA por valor (achado A4 da auditoria de abrangência, Parte
  // 6/Configurações) — só entra em jogo indo PRA APROVADO (qualquer outra
  // transição não muda). Valor considerado: a cotação vencedora quando
  // existe (é a fonte da verdade da decisão, mesmo raciocínio do bloco
  // logo abaixo pra fornecedorIdFinal), senão o valorEstimado da própria
  // solicitação. Sem nenhum valor conhecido (SOLICITADO→APROVADO direto,
  // sem cotação, sem valorEstimado informado), não há o que checar — segue
  // sem bloquear, mesmo comportamento de hoje.
  if (proximoStatus === "APROVADO") {
    const valorParaChecagem = cotacaoVencedora ? cotacaoVencedora.valorTotal : solicitacao.valorEstimado;
    if (valorParaChecagem !== null) {
      let papelAprovador = usuario.papel ?? null;
      if (papelAprovador === null) {
        const aprovador = await prisma.usuario.findUnique({
          where: { id: usuario.id },
          select: { papel: true },
        });
        papelAprovador = aprovador?.papel ?? null;
      }

      if (papelAprovador !== null) {
        const alcadas = await prisma.alcadaAprovacao.findMany({
          where: { graficaId: solicitacao.graficaId, tipo: "APROVACAO_COMPRA" },
          select: { papel: true, usuarioId: true, limite: true },
        });
        const limiteResolvido = resolverLimiteAprovacaoCompra(
          { id: usuario.id, papel: papelAprovador },
          alcadas.map((a) => ({ papel: a.papel, usuarioId: a.usuarioId, limite: Number(a.limite) }))
        );

        if (limiteResolvido !== null && new D(valorParaChecagem.toString()).gt(limiteResolvido)) {
          return {
            ok: false,
            mensagem: `Esta solicitação (${formatoMoeda.format(Number(valorParaChecagem))}) está acima da sua alçada de aprovação (até ${formatoMoeda.format(limiteResolvido)}) — peça pra alguém com alçada maior aprovar.`,
          };
        }
      }
    }
  }

  // A cotação vencedora, quando existe, tem prioridade sobre qualquer
  // fornecedorId/valorEstimado manual enviado pelo formulário — ela é a
  // fonte da verdade da decisão (achado A4: "copiar pra solicitação").
  const fornecedorIdFinal = cotacaoVencedora
    ? cotacaoVencedora.fornecedorId
    : dados.fornecedorId !== undefined
      ? dados.fornecedorId
      : solicitacao.fornecedorId;
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
  if (cotacaoVencedora) {
    // Copia da cotação vencedora pra solicitação — fornecedorId e
    // valorEstimado (a estimativa passa a refletir o total de fato cotado,
    // mais preciso que o palpite original da criação da solicitação).
    // valorFinal (o que de fato foi pago) continua intocado, só é definido
    // depois em COMPRADO.
    dadosUpdate.fornecedorId = cotacaoVencedora.fornecedorId;
    dadosUpdate.valorEstimado = cotacaoVencedora.valorTotal;
  } else if (dados.fornecedorId !== undefined) {
    dadosUpdate.fornecedorId = fornecedorIdFinal;
  }
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

        // Achado A3 da auditoria de abrangência (Parte 3/Compras): compra
        // sob encomenda (origem=PEDIDO_ESPECIFICO) vira CustoPedido origem
        // COMPRA deste pedido — REPOSICAO_ESTOQUE e as demais origens nunca
        // têm pedidoId, então nunca entram aqui (comportamento de hoje
        // preservado). Nunca lança (ver comentário de
        // criarCustoAutomaticoCompra em src/lib/custo-pedido.ts).
        if (solicitacao.pedidoId && valorFinalFinal !== null) {
          const itemGraficaMaterial = await tx.itemGrafica.findUnique({
            where: { id: solicitacao.itemGraficaId },
            select: { categoriaCustoId: true },
          });
          await criarCustoAutomaticoCompra(tx, {
            graficaId: solicitacao.graficaId,
            pedidoId: solicitacao.pedidoId,
            solicitacaoCompraId: solicitacao.id,
            itemGraficaId: solicitacao.itemGraficaId,
            varianteId: solicitacao.varianteId,
            categoriaCustoIdMaterial: itemGraficaMaterial?.categoriaCustoId ?? null,
            valor: valorFinalFinal,
          });
        }

        // Achado A9 da auditoria de abrangência (Parte 3/Compras): compra
        // vinculada a um contrato de fornecimento (origem=CONTRATO_PROGRAMADO)
        // consome parte da quantidade contratada assim que o material chega
        // de fato — increment() do Prisma, nunca leitura+gravação em passos
        // separados, pra nunca perder incremento sob concorrência (duas
        // solicitações do mesmo contrato confirmando RECEBIDO ao mesmo tempo).
        if (solicitacao.contratoFornecimentoId) {
          await tx.contratoFornecimento.update({
            where: { id: solicitacao.contratoFornecimentoId },
            data: { quantidadeConsumida: { increment: quantidadeDec.toFixed(4) } },
          });
        }
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
