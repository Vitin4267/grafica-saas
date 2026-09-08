import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { PapelUsuario } from "@/generated/prisma/enums";
import { D, type Dec } from "@/lib/pricing/decimal";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_SOLICITACAO_COMPRA,
  type StatusSolicitacaoCompra,
  type TipoCompra,
} from "@/lib/compras-status";
import { criarCustoAutomaticoCompra } from "@/lib/custo-pedido";
import { resolverLimiteAprovacaoCompra } from "@/lib/alcada-aprovacao";
import { formatoMoeda } from "@/lib/moeda";
import { calcularCustoAquisicaoTotal } from "@/lib/custo-aquisicao-compra";

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
  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // nullable: compra sem alvo estruturado no catálogo (ver tipoCompra
  // abaixo e descricaoLivre no schema).
  itemGraficaId: string | null;
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
  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // opcional só pra não quebrar chamador/teste anterior a esta feature;
  // ausente (undefined) é tratado igual a "MATERIA_PRIMA" abaixo (o
  // default do schema, e o único valor que qualquer solicitação anterior a
  // esta feature podia ter). Decide, junto de itemGraficaId, se RECEBIDO
  // gera MovimentacaoEstoque (ver geraMovimentacaoEstoque abaixo).
  tipoCompra?: TipoCompra;
  // Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // "rota curta" de custo de aquisição real, todos opcionais (ver
  // calcularCustoAquisicaoTotal em src/lib/custo-aquisicao-compra.ts).
  // Ausentes/null = comportamento de hoje (custoAquisicaoTotal ===
  // valorFinal).
  valorFrete?: Prisma.Decimal | null;
  valorIpi?: Prisma.Decimal | null;
  valorIcmsCreditavel?: Prisma.Decimal | null;
  valorDesconto?: Prisma.Decimal | null;
  // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
  // recebimento parcial: CUMULATIVO — tudo que já foi efetivamente
  // conferido até agora, somando todas as confirmações de RECEBIDO/
  // RECEBIDO_PARCIAL desta solicitação (ver comentário do campo no schema).
  // null/undefined tratado como 0 (nenhuma confirmação ainda) — cobre tanto
  // "campo ainda não existe nesta linha" quanto testes/chamadores anteriores
  // a esta feature.
  quantidadeRecebida?: Prisma.Decimal | null;
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
  // Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // mesmo campo contextual de valorFinal (só relevante em COMPRADO, ver
  // camposContextuais em AcoesSolicitacaoForm.tsx): `undefined` = "não
  // mexer", `null` = "limpar", número = "definir".
  valorFrete?: number | null;
  valorIpi?: number | null;
  valorIcmsCreditavel?: number | null;
  valorDesconto?: number | null;
  // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
  // campos do passo "confirmar recebimento" (proximoStatus=RECEBIDO, tanto
  // vindo de COMPRADO quanto reabrindo a partir de RECEBIDO_PARCIAL).
  //
  // quantidadeRecebida aqui é o INCREMENTO desta confirmação (quanto chegou
  // NESTA vez) — DIFERENTE de SolicitacaoParaTransicao.quantidadeRecebida
  // acima, que é o acumulado já gravado no banco antes desta chamada.
  // Obrigatório (não `undefined`) quando proximoStatus=RECEBIDO — sem ele a
  // função nem sabe quanto lançar na MovimentacaoEstoque.
  quantidadeRecebida?: number | null;
  // Opcional, puramente informativo (ver comentário no schema) —
  // `undefined` = "não mexer", `null` = "limpar", número = "definir".
  valorNotaFiscal?: number | null;
  // Exigido pela própria função (não aqui no tipo) quando a quantidade
  // recebida nesta confirmação diverge do restante esperado.
  divergenciaObservacao?: string | null;
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
// uma transição. RECEBIDO_PARCIAL fica de fora de propósito: `proximoStatus`
// pedido é sempre "RECEBIDO" (nunca "RECEBIDO_PARCIAL" literal, ver bloco de
// recebimento parcial em avancarStatusCompra) — este mapa é indexado pelo
// status REQUISITADO, então `recebidoEm` já é setado aqui em toda confirmação
// (parcial ou final) e funciona como "data do ÚLTIMO recebimento".
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

  // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
  // recebimento parcial. `proximoStatus` pedido é sempre "RECEBIDO" (a UI
  // reabre a mesma ação a partir de RECEBIDO_PARCIAL, ver
  // ROTULO_PROXIMA_ETAPA em src/lib/compras-status.ts) — quem decide o
  // status REAL gravado é esta função, comparando o acumulado com o total
  // solicitado. Calculado ANTES de `dadosUpdate` pra poder sobrescrever
  // `status` abaixo com o valor real (RECEBIDO ou RECEBIDO_PARCIAL).
  let statusRecebimentoReal: "RECEBIDO" | "RECEBIDO_PARCIAL" | null = null;
  let incrementoRecebidoDec: Dec | null = null;
  let quantidadeRecebidaAcumuladaDec: Dec | null = null;
  if (proximoStatus === "RECEBIDO") {
    if (dados.quantidadeRecebida === undefined || dados.quantidadeRecebida === null || dados.quantidadeRecebida <= 0) {
      return { ok: false, mensagem: "Informe a quantidade recebida antes de confirmar o recebimento." };
    }

    const quantidadeSolicitadaDec = new D(solicitacao.quantidade.toString());
    const quantidadeJaRecebidaDec =
      solicitacao.quantidadeRecebida !== null && solicitacao.quantidadeRecebida !== undefined
        ? new D(solicitacao.quantidadeRecebida.toString())
        : new D(0);
    const restanteEsperadoDec = quantidadeSolicitadaDec.minus(quantidadeJaRecebidaDec);

    incrementoRecebidoDec = new D(dados.quantidadeRecebida.toString());
    quantidadeRecebidaAcumuladaDec = quantidadeJaRecebidaDec.plus(incrementoRecebidoDec);
    statusRecebimentoReal = quantidadeRecebidaAcumuladaDec.gte(quantidadeSolicitadaDec) ? "RECEBIDO" : "RECEBIDO_PARCIAL";

    // Divergência: a quantidade informada nesta confirmação não bate com o
    // restante esperado (pra mais ou pra menos — avaria, erro de separação
    // do fornecedor, sobra negociada etc.) — exige observação explicando.
    // Quando bate exato, divergenciaObservacao não é tocado (fica como
    // estava, ver bloco de dadosUpdate abaixo).
    if (!incrementoRecebidoDec.eq(restanteEsperadoDec)) {
      if (!dados.divergenciaObservacao?.trim()) {
        return {
          ok: false,
          mensagem: `A quantidade recebida (${incrementoRecebidoDec.toFixed(4)}) é diferente do restante esperado (${restanteEsperadoDec.toFixed(4)}) — registre uma observação explicando a divergência.`,
        };
      }
    }
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
  if (proximoStatus === "COMPRADO") {
    dadosUpdate.valorFinal = valorFinalFinal;
    // Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
    // mesmo padrão undefined/null/valor de documento acima.
    if (dados.valorFrete !== undefined) dadosUpdate.valorFrete = dados.valorFrete;
    if (dados.valorIpi !== undefined) dadosUpdate.valorIpi = dados.valorIpi;
    if (dados.valorIcmsCreditavel !== undefined) dadosUpdate.valorIcmsCreditavel = dados.valorIcmsCreditavel;
    if (dados.valorDesconto !== undefined) dadosUpdate.valorDesconto = dados.valorDesconto;
  }
  if (proximoStatus === "RECEBIDO" && statusRecebimentoReal && quantidadeRecebidaAcumuladaDec) {
    // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
    // `status` sobrescreve o "RECEBIDO" requisitado pelo real (pode ficar
    // RECEBIDO_PARCIAL). `recebidoEm` (já setado acima via CAMPO_DATA_POR_STATUS,
    // que mapeia RECEBIDO) fica valendo como "data do ÚLTIMO recebimento",
    // parcial ou final — não é retroativo, então preservar esse valor
    // também serve pro caso parcial.
    dadosUpdate.status = statusRecebimentoReal;
    dadosUpdate.quantidadeRecebida = quantidadeRecebidaAcumuladaDec.toFixed(4);
    if (dados.valorNotaFiscal !== undefined) dadosUpdate.valorNotaFiscal = dados.valorNotaFiscal;
    const divergenciaTexto = dados.divergenciaObservacao?.trim();
    if (divergenciaTexto) dadosUpdate.divergenciaObservacao = divergenciaTexto;
  }

  try {
    if (proximoStatus === "RECEBIDO") {
      // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06)
      // — só compra de matéria-prima COM item de catálogo vira estoque.
      // Compra de serviço/peça/equipamento (tipoCompra != MATERIA_PRIMA),
      // ou até matéria-prima sem item estruturado (só descricaoLivre),
      // nunca gera MovimentacaoEstoque nem mexe em estoqueAtual — vira só
      // custo do pedido (bloco de CustoPedido abaixo), quando há pedidoId.
      // tipoCompra ausente (chamador/teste anterior a esta feature) é
      // tratado como MATERIA_PRIMA, o único valor possível antes dela.
      const tipoCompraEfetivo = solicitacao.tipoCompra ?? "MATERIA_PRIMA";
      const geraMovimentacaoEstoque = tipoCompraEfetivo === "MATERIA_PRIMA" && solicitacao.itemGraficaId !== null;

      // Leitura do estoque atual FORA da transação (mantém a transação
      // curta, mesmo padrão de lancarEntradaCompra em
      // src/app/catalogo/[itemGraficaId]/actions.ts) — o CAS abaixo garante
      // que ninguém mexeu no estoque entre esta leitura e a escrita. Pulada
      // inteiramente quando a compra não gera movimentação de estoque.
      const registroEstoque = !geraMovimentacaoEstoque
        ? null
        : solicitacao.varianteId
          ? await prisma.varianteMateriaPrima.findUnique({
              where: { id: solicitacao.varianteId },
              select: { estoqueAtual: true },
            })
          : await prisma.itemGrafica.findUnique({
              where: { id: solicitacao.itemGraficaId! },
              select: { estoqueAtual: true },
            });

      // Achado N15 da auditoria de abrangência (Parte 7,
      // pesquisa-abrangencia-modulos.md) — estoqueAtual = null é a
      // convenção do projeto pra "item sem controle de estoque" (mesmo
      // guard respeitado pela baixa de produção, ver
      // src/app/producao/status-transicao.ts: `if (estoqueAtual === null)
      // continue`). Uma compra recebida de um item nessa condição NUNCA
      // deve fazer o item "nascer" com saldo — pula a alta de
      // estoque/MovimentacaoEstoque abaixo, e só registra o custo da compra
      // normalmente (blocos de CustoPedido/ContratoFornecimento, que não
      // dependem de estoque). Distinto de "registro não encontrado"
      // (`registroEstoque === null`, não deveria acontecer — FK garante
      // que o item existe — mas se acontecer preserva o comportamento de
      // sempre, tratando como estoque zerado).
      const semControleEstoque =
        geraMovimentacaoEstoque && registroEstoque !== null && registroEstoque.estoqueAtual === null;
      const estoqueAnterior = registroEstoque?.estoqueAtual;

      // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07)
      // — o que entra em estoque/MovimentacaoEstoque NESTA confirmação é só
      // o INCREMENTO desta vez (incrementoRecebidoDec, validado acima), não
      // mais necessariamente `solicitacao.quantidade` inteira. `quantidadeDec`
      // (nome mantido pro resto do bloco, ex: variável usada no increment()
      // de ContratoFornecimento mais abaixo) É o incremento.
      const quantidadeDec = incrementoRecebidoDec!;
      const novoEstoque = new D(estoqueAnterior?.toString() ?? 0).plus(quantidadeDec).toFixed(4);
      // Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06)
      // — custoUnitario/custoTotal snapshotados na MovimentacaoEstoque (e o
      // "valor" do CustoPedido gerado abaixo, quando há pedidoId) usam o
      // custo de aquisição REAL (valorFinal + frete + IPI - ICMS
      // creditável - desconto), não só valorFinal — é o que a gráfica de
      // fato pagou por unidade. PONTO MAIS IMPORTANTE DO ACHADO: sem esta
      // troca, os campos novos (valorFrete/valorIpi/valorIcmsCreditavel/
      // valorDesconto) existiriam sem nenhum efeito. Ver
      // calcularCustoAquisicaoTotal em src/lib/custo-aquisicao-compra.ts —
      // os 4 componentes ausentes (compra antiga, ou nova sem preenchê-
      // los) reduzem a EXATAMENTE valorFinal, comportamento de hoje
      // preservado (ver testes de compatibilidade em status-transicao.test.ts).
      //
      // custoAquisicaoTotalDec é o custo da NOTA INTEIRA (a solicitação
      // toda) — continua o mesmo em qualquer recebimento, parcial ou não.
      // Achado A7: custoUnitarioDec (preço por unidade, constante entre
      // recebimentos parciais) divide pelo total SOLICITADO, não pelo
      // incremento desta vez — só o custoTotal LANÇADO nesta
      // MovimentacaoEstoque (custoTotalDesteLoteDec, abaixo) é prorateado
      // pelo incremento. Em recebimento único (comportamento de hoje,
      // incremento === total solicitado), custoTotalDesteLoteDec ==
      // custoAquisicaoTotalDec — zero regressão.
      const quantidadeSolicitadaDec = new D(solicitacao.quantidade.toString());
      const custoAquisicaoTotalDec =
        valorFinalFinal !== null
          ? calcularCustoAquisicaoTotal(
              valorFinalFinal,
              solicitacao.valorFrete,
              solicitacao.valorIpi,
              solicitacao.valorIcmsCreditavel,
              solicitacao.valorDesconto
            )
          : null;
      const custoUnitarioDec =
        custoAquisicaoTotalDec !== null && quantidadeSolicitadaDec.gt(0)
          ? custoAquisicaoTotalDec.div(quantidadeSolicitadaDec)
          : null;
      const custoTotalDesteLoteDec = custoUnitarioDec !== null ? custoUnitarioDec.times(quantidadeDec) : null;

      await prisma.$transaction(async (tx) => {
        const casStatus = await tx.solicitacaoCompra.updateMany({
          where: { id: solicitacao.id, status: statusAnterior },
          data: dadosUpdate as Prisma.SolicitacaoCompraUpdateManyMutationInput,
        });
        if (casStatus.count === 0) throw new ErroSolicitacaoJaAlterada();

        if (geraMovimentacaoEstoque && !semControleEstoque) {
          const casEstoque = solicitacao.varianteId
            ? await tx.varianteMateriaPrima.updateMany({
                where: { id: solicitacao.varianteId, estoqueAtual: estoqueAnterior ?? null },
                data: { estoqueAtual: novoEstoque },
              })
            : await tx.itemGrafica.updateMany({
                where: { id: solicitacao.itemGraficaId!, estoqueAtual: estoqueAnterior ?? null },
                data: { estoqueAtual: novoEstoque },
              });
          if (casEstoque.count === 0) throw new ErroEstoqueDivergenteCompra();

          await tx.movimentacaoEstoque.create({
            data: {
              itemGraficaId: solicitacao.itemGraficaId!,
              varianteId: solicitacao.varianteId,
              solicitacaoCompraId: solicitacao.id,
              tipo: "ENTRADA_COMPRA",
              quantidade: quantidadeDec.toFixed(4),
              custoUnitario: custoUnitarioDec ? custoUnitarioDec.toFixed(4) : null,
              // Achado A7: prorateado pelo incremento desta confirmação —
              // não o custo da nota inteira (custoAquisicaoTotalDec), que
              // já pode ter sido total ou parcialmente lançado em
              // confirmações anteriores desta mesma solicitação.
              custoTotal: custoTotalDesteLoteDec ? custoTotalDesteLoteDec.toFixed(2) : null,
              metodoCusteio: "ULTIMA_COMPRA",
              precoReferenciaEm: new Date(),
              documento: documentoFinal,
              fornecedorId: fornecedorIdFinal,
              criadoPorId: usuario.id,
            },
          });
        }

        // Achado A3 da auditoria de abrangência (Parte 3/Compras): compra
        // sob encomenda (origem=PEDIDO_ESPECIFICO) vira CustoPedido origem
        // COMPRA deste pedido — REPOSICAO_ESTOQUE e as demais origens nunca
        // têm pedidoId, então nunca entram aqui (comportamento de hoje
        // preservado). Nunca lança (ver comentário de
        // criarCustoAutomaticoCompra em src/lib/custo-pedido.ts). Achado A1
        // — pedidoId + compra de serviço/peça sem item de catálogo também
        // entra aqui (itemGraficaId null é aceito). Achado A2 — o valor
        // lançado é o custo de aquisição REAL, não só valorFinal.
        //
        // Achado A7 (recebimento parcial): DELIBERADAMENTE só dispara na
        // confirmação que FECHA o total (statusRecebimentoReal="RECEBIDO"),
        // nunca numa parcial intermediária — CustoPedido.solicitacaoCompraId
        // é @unique (dedup: uma solicitação nunca gera dois CustoPedido), e
        // criarCustoAutomaticoCompra já é no-op se chamado de novo pra
        // mesma solicitação (ver jaExiste ali) — então lançar cedo, na
        // primeira parcial, perderia silenciosamente o resto do custo do
        // pedido nas confirmações seguintes. Lançando só no fechamento, o
        // valor usado continua sendo o da NOTA INTEIRA
        // (custoAquisicaoTotalDec), exatamente como antes desta feature.
        if (statusRecebimentoReal === "RECEBIDO" && solicitacao.pedidoId && custoAquisicaoTotalDec !== null) {
          const itemGraficaMaterial = solicitacao.itemGraficaId
            ? await tx.itemGrafica.findUnique({
                where: { id: solicitacao.itemGraficaId },
                select: { categoriaCustoId: true },
              })
            : null;
          await criarCustoAutomaticoCompra(tx, {
            graficaId: solicitacao.graficaId,
            pedidoId: solicitacao.pedidoId,
            solicitacaoCompraId: solicitacao.id,
            itemGraficaId: solicitacao.itemGraficaId,
            varianteId: solicitacao.varianteId,
            categoriaCustoIdMaterial: itemGraficaMaterial?.categoriaCustoId ?? null,
            valor: custoAquisicaoTotalDec.toNumber(),
          });
        }

        // Achado A9 da auditoria de abrangência (Parte 3/Compras): compra
        // vinculada a um contrato de fornecimento (origem=CONTRATO_PROGRAMADO)
        // consome parte da quantidade contratada assim que o material chega
        // de fato — increment() do Prisma, nunca leitura+gravação em passos
        // separados, pra nunca perder incremento sob concorrência (duas
        // solicitações do mesmo contrato confirmando RECEBIDO ao mesmo tempo).
        //
        // Achado A7 (recebimento parcial): mesmo raciocínio do bloco de
        // CustoPedido acima — só dispara no fechamento
        // (statusRecebimentoReal="RECEBIDO"), incrementando de uma vez o
        // total SOLICITADO (quantidadeSolicitadaDec), não o incremento desta
        // última confirmação — o contrato reflete "quanto desta solicitação
        // foi consumido do teto contratado", que é o total pedido, não
        // quantos lotes parciais levaram até lá.
        if (statusRecebimentoReal === "RECEBIDO" && solicitacao.contratoFornecimentoId) {
          await tx.contratoFornecimento.update({
            where: { id: solicitacao.contratoFornecimentoId },
            data: { quantidadeConsumida: { increment: quantidadeSolicitadaDec.toFixed(4) } },
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

  // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
  // o status REAL gravado pode divergir do `proximoStatus` requisitado
  // (RECEBIDO pedido, RECEBIDO_PARCIAL gravado) — a mensagem/resultado
  // devolvidos (e o log de auditoria em quem chama, ver
  // src/app/compras/actions.ts) refletem o que foi REALMENTE gravado.
  const statusFinal = statusRecebimentoReal ?? proximoStatus;

  return {
    ok: true,
    mensagem: `Avançado para "${ROTULOS_STATUS_SOLICITACAO_COMPRA[statusFinal]}".`,
    statusAnterior,
    proximoStatus: statusFinal,
  };
}
