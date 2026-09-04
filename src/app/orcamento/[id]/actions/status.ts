"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import { put, del } from "@vercel/blob";
import { exigirTokenBlobPrivado } from "@/lib/blob-assinado";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { resolverLimiteDesconto, type AlcadaParaResolucao } from "@/lib/alcada-aprovacao";
import { calcularItemOrcamento, recalcularTotalOrcamento } from "@/lib/orcamento-precificacao";
import { analisarPreflight } from "@/lib/preflight";
import { resolverOrigemPublica } from "@/lib/url-publica";
import {
  validarArquivoArte,
  extensaoArte,
  assinaturaBateComTipo,
  BYTES_ASSINATURA,
} from "@/lib/upload-validacao";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_ORCAMENTO,
  type StatusOrcamento,
} from "@/lib/orcamento-status";
import {
  verificarProntidaoFiscal,
  prepararNotificacaoNotaFiscal,
  resolverDadosFiscais,
  resolverCfop,
  type DadosFiscaisResolvidos,
} from "@/lib/nota-fiscal";
import {
  emitirNfe,
  consultarNfe,
  ErroFocusNfe,
  type AmbienteFocusNfe,
  type RespostaFocusNfe,
  type ItemNfe,
} from "@/lib/focus-nfe";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateResponsavelNotaFiscal } from "@/lib/email/templates";
import { registrarAuditoria } from "@/lib/auditoria";
import { abrirApontamentoInicialSeNecessario } from "@/lib/apontamento-etapa";
import { formatoMoeda } from "@/lib/moeda";
import { dataInputParaUTC, dataHoraInputParaUTC, formatoInstanteReal } from "@/lib/data";
import {
  ETAPAS_ORCAMENTO,
  nomeCampoEtapaEm,
  nomeCampoEtapaResponsavel,
  type ChaveEtapaOrcamento,
} from "@/lib/orcamento-etapas";
import {
  validarContagemCor,
  normalizarRebobinamento,
  validarMaterialSubstratoOutro,
  validarCampoOutro,
} from "@/lib/orcamento-etiqueta";
import { parseJsonArray } from "@/lib/form-json";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { calcularValorBase, calcularComissao } from "@/lib/comissao";
import {
  removerArquivo,
  resolverContextoArmazenamento,
  reservarEspaco,
  confirmarArquivo,
  cancelarReserva,
} from "@/lib/billing/armazenamento";
import { calcularPrevisaoAprovacaoPedido, gravarPrevisaoAprovacaoPedido } from "@/lib/pedido-aprovacao";
import { criarCustoAutomaticoComissao } from "@/lib/custo-pedido";
import { gerarContasReceberDaAprovacao, gerarContasReceberDaEmissaoNota } from "@/lib/condicao-pagamento";
import { calcularExposicaoCreditoCliente } from "@/lib/exposicao-credito-cliente";
import { lancarConsumoCreditoCliente } from "@/lib/credito-cliente";
import { saldoContaReceber } from "@/lib/baixa-financeira";
import { registrarCandidatosGangRun } from "@/lib/gang-run-servico";
import { resolverOpcoesNaAprovacao, descartarOpcoesAlternativas } from "@/lib/orcamento-opcoes";
import { UNIDADES_DIMENSAO, converterParaCm } from "@/lib/unidade-dimensao";
import { paraDecimal, type Dec } from "@/lib/pricing/decimal";
import { aplicarPisoDoPedido } from "@/lib/pricing";
import { montarDadosItemParaRecalculo, calcularDescontoHerdado } from "@/lib/orcamento-duplicar";

// Sinaliza, de dentro de uma transação Serializable, que o valor de crédito
// que o vendedor pediu pra abater excede o saldo disponível do cliente.
// Re-checado DENTRO da transação (ver lancarConsumoCreditoCliente em
// src/lib/credito-cliente.ts) — nunca confia só na leitura de fora.
class ErroCreditoClienteInsuficiente extends Error {}

// novoStatus é só informativo (preenchido nas respostas de sucesso) — deixa o
// client (OrcamentoAcoes.tsx) saber QUAL transição aconteceu sem precisar
// inferir do status anterior, pra decidir se mostra a micro-animação de
// aprovação. Não participa da lógica de compare-and-swap abaixo.
export type AtualizarStatusResult = {
  ok: boolean;
  mensagem: string;
  novoStatus?: StatusOrcamento;
  // Não bloqueia a aprovação por padrão (achado A9, 2026-08-24, e achado A6
  // da Parte 4, 2026-08-27) — só avisa quem aprovou que o cliente está
  // bloqueado pra venda/faturamento ou que este orçamento estoura o limite
  // de crédito configurado, pra decisão consciente em vez de aprovação
  // automática silenciosa. As 3 causas são compostas num único texto (ver
  // final de atualizarStatusOrcamento). OrcamentoAcoes.tsx mostra isso mesmo
  // no caminho de sucesso do APROVADO, que normalmente esconde `mensagem`.
  // O estouro de limite de crédito pode virar bloqueio DE VERDADE (a
  // aprovação falha com ok:false em vez de popular este campo) quando
  // ParametrosGrafica.bloqueiaAoUltrapassarLimiteCredito está ligada — os
  // bloqueios manuais (bloqueadoParaVenda/bloqueadoParaFaturamento) nunca
  // bloqueiam de verdade, só avisam, independente dessa flag.
  aviso?: string;
};

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
    // vendedorId: achado A8 — ver bloco de comissão logo abaixo.
    // limiteCredito/bloqueadoParaFaturamento/motivoBloqueioFaturamento:
    // achado A6 da Parte 4 — ver bloco de crédito logo abaixo.
    include: {
      cliente: {
        select: {
          bloqueadoParaVenda: true,
          motivoBloqueio: true,
          vendedorId: true,
          limiteCredito: true,
          bloqueadoParaFaturamento: true,
          motivoBloqueioFaturamento: true,
        },
      },
    },
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

  // Hoisted pra fora do bloco de APROVADO abaixo (que é seu próprio escopo de
  // bloco) — precisa estar visível lá embaixo, na composição do `aviso` final.
  let avisoExcedeCredito: string | undefined;

  if (novoStatus === "APROVADO") {
    // Opcional: string vazia (campo em branco) vira undefined, pedido nasce
    // sem prazo e nunca vai gerar alerta de atraso (ver src/lib/alerta-atraso.ts).
    const prazoEntregaBruto = formData.get("prazoEntrega");
    const prazoEntrega =
      typeof prazoEntregaBruto === "string" && prazoEntregaBruto
        ? dataInputParaUTC(prazoEntregaBruto)
        : undefined;

    // Achado A13 da auditoria de abrangência — quanto do CreditoCliente
    // (saldo adiantado do cliente, ver src/lib/credito-cliente.ts) o
    // vendedor está optando por abater deste orçamento. Campo em branco
    // (o caso de sempre, hoje) não usa crédito nenhum — nunca automático,
    // sempre uma escolha explícita no momento da aprovação.
    const usarCreditoBruto = formData.get("usarCredito");
    const usarCreditoValor =
      typeof usarCreditoBruto === "string" && usarCreditoBruto && Number(usarCreditoBruto) > 0
        ? paraDecimal(usarCreditoBruto)
        : undefined;

    // Qual opção o vendedor está aprovando em nome do cliente (ver
    // src/lib/orcamento-opcoes.ts) — string vazia (orçamento sem opções
    // alternativas, o caso de sempre; OrcamentoAcoes.tsx só renderiza o
    // seletor quando existem) vira null, a opção-base. Validada contra o
    // banco ANTES de qualquer leitura/transação: um id que não pertence a
    // este orçamento nunca deveria promover nada.
    const opcaoIdBruto = String(formData.get("opcaoId") || "").trim();
    const opcaoEscolhidaId = opcaoIdBruto || null;
    if (opcaoEscolhidaId) {
      const opcaoValida = await prisma.orcamentoOpcao.findFirst({
        where: { id: opcaoEscolhidaId, orcamentoId },
        select: { id: true },
      });
      if (!opcaoValida) {
        return { ok: false, mensagem: "Opção escolhida não encontrada neste orçamento." };
      }
    }

    // Leitura fora da transação de propósito (mesmo cuidado de avancarPedido
    // em src/app/producao/actions.ts): ficha de custo/comissão não muda por
    // causa de uma corrida de atualizarStatusOrcamento, então não precisa
    // fazer parte da transação — mantém ela curta. Mesmo cuidado vale pra
    // previsaoCusto (fase "custo real", §3.1): a leitura de breakdown/ficha
    // técnica também não muda por causa desta corrida. opcaoId:
    // opcaoEscolhidaId — sempre os itens da opção ESCOLHIDA (base ou
    // alternativa), nunca "todos os itens do orçamento" (que incluiria
    // opções perdedoras, se houver mais de uma).
    const [orcamentoComItens, parametros, previsaoCusto] = await Promise.all([
      prisma.orcamentoItem.findMany({
        where: { orcamentoId, opcaoId: opcaoEscolhidaId },
        include: { itemGrafica: { select: { precoCompra: true } } },
      }),
      prisma.parametrosGrafica.findUnique({
        where: { graficaId: usuario.graficaId },
        select: {
          comissaoVendedorBase: true,
          comissaoEntraNoCustoPedido: true,
          comissaoSegueVendedorDoCliente: true,
          bloqueiaAoUltrapassarLimiteCredito: true,
        },
      }),
      calcularPrevisaoAprovacaoPedido(orcamentoId, usuario.graficaId, undefined, opcaoEscolhidaId),
    ]);

    // Achado A8 da auditoria de abrangência — a quem a comissão é atribuída.
    // Leitura tardia direto de Cliente.vendedorId (mesmo princípio de
    // margemLucroOverride em src/lib/orcamento-precificacao.ts: nunca
    // snapshotado em Orcamento, sempre lido do cliente no momento em que é
    // consumido) — aqui o único ponto de consumo é a criação da Comissao,
    // que acontece uma vez só, no momento da aprovação, então não há
    // necessidade de um campo novo em Orcamento. Fallback pra
    // Orcamento.usuarioId (comportamento de hoje) quando a flag está
    // desligada OU o cliente não tem vendedor atribuído.
    const vendedorComissaoId =
      parametros?.comissaoSegueVendedorDoCliente && orcamento.cliente.vendedorId
        ? orcamento.cliente.vendedorId
        : orcamento.usuarioId;

    const usuarioVendedor = await prisma.usuario.findUnique({
      where: { id: vendedorComissaoId },
      select: { comissaoPercent: true },
    });

    // Total da opção ESCOLHIDA — nunca orcamento.total direto: antes da
    // promoção (que só acontece dentro da transação abaixo, via
    // resolverOpcoesNaAprovacao), orcamento.total ainda reflete só a
    // opção-base, mesmo que uma alternativa tenha sido a escolhida.
    const totalEscolhidoNumero = orcamentoComItens.reduce(
      (soma, item) => soma + Number(item.precoTotal),
      0
    );

    // Achado A6 da Parte 4 da auditoria de abrangência — estouro de limite
    // de crédito detectado automaticamente (ver comentário em Cliente no
    // schema.prisma pra distinção com bloqueadoParaVenda, que é manual).
    // limiteCredito null = sem limite configurado, nenhuma checagem roda
    // (comportamento de hoje). ParametrosGrafica.bloqueiaAoUltrapassarLimiteCredito
    // decide se isso vira erro (aprovação recusada, ANTES da transação que
    // cria o Pedido) ou só aviso — mesmo espírito de descontoMaxSemAprovacao,
    // mas nunca vale pro bloqueio MANUAL (bloqueadoParaVenda/
    // bloqueadoParaFaturamento), que continua só avisando sempre.
    if (orcamento.cliente.limiteCredito !== null) {
      const limite = Number(orcamento.cliente.limiteCredito);
      const exposicaoAtual = await calcularExposicaoCreditoCliente(orcamento.clienteId);
      const exposicaoTotal = exposicaoAtual + totalEscolhidoNumero;
      if (exposicaoTotal > limite) {
        if (parametros?.bloqueiaAoUltrapassarLimiteCredito) {
          return {
            ok: false,
            mensagem: `Aprovação recusada: a exposição de crédito do cliente chegaria a ${formatoMoeda.format(exposicaoTotal)}, acima do limite de ${formatoMoeda.format(limite)} configurado no cadastro. Ajuste o limite em Clientes ou desligue "Bloquear ao ultrapassar limite de crédito" em Configurações pra aprovar mesmo assim.`,
          };
        }
        const percentualExcedente = limite > 0 ? (exposicaoTotal / limite - 1) * 100 : 100;
        avisoExcedeCredito = `Atenção: este orçamento deixa o cliente ${percentualExcedente.toFixed(0)}% acima do limite de crédito configurado (exposição total de ${formatoMoeda.format(exposicaoTotal)} contra limite de ${formatoMoeda.format(limite)}).`;
      }
    }

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
            const valorBase = calcularValorBase(totalEscolhidoNumero, itensComCusto, baseCalculo);
            const valorComissao = calcularComissao(valorBase, percentualVendedor);
            return { baseCalculo, valorBase, valorComissao };
          })()
        : null;

    // Compare-and-swap: só transiciona (e cria pedido/comissão) se o status
    // AINDA for o que validamos — senão duas transições concorrentes (ex: link
    // público aprovando enquanto o painel rejeita) poderiam ambas passar e a
    // última venceria, deixando um Pedido órfão. upsert continua idempotente
    // contra duplo clique (orcamentoId único em Pedido e Comissao).
    let aprovado: boolean;
    try {
      aprovado = await prisma.$transaction(async (tx) => {
        const cas = await tx.orcamento.updateMany({
          where: { id: orcamentoId, status: orcamento.status },
          data: { status: "APROVADO" },
        });
        if (cas.count === 0) return false;

      // Promove a opção escolhida (descarta as outras — ver
      // src/lib/orcamento-opcoes.ts) e grava o total/nome final ANTES do
      // upsert de Pedido abaixo, que já depende do total correto.
      const resolucaoOpcoes = await resolverOpcoesNaAprovacao(tx, { orcamentoId, opcaoEscolhidaId });
      await tx.orcamento.update({
        where: { id: orcamentoId },
        data: { total: resolucaoOpcoes.total, opcaoEscolhidaNome: resolucaoOpcoes.opcaoEscolhidaNome },
      });

      // Achado A7 da Parte 4 — só gera algo quando o orçamento tem uma
      // CondicaoPagamento vinculada E ela usa âncora APROVACAO (ver
      // src/lib/condicao-pagamento.ts pro resto do escopo/gap). Total já
      // resolvido acima (pós-promoção de opção), nunca orcamento.total cru.
      await gerarContasReceberDaAprovacao(tx, {
        graficaId: usuario.graficaId,
        orcamentoId,
        clienteId: orcamento.clienteId,
        condicaoPagamentoId: orcamento.condicaoPagamentoId,
        total: Number(resolucaoOpcoes.total),
        aprovadoEm: new Date(),
      });

      const pedido = await tx.pedido.upsert({
        where: { orcamentoId },
        update: {},
        create: {
          graficaId: usuario.graficaId,
          orcamentoId,
          status: "ARTE",
          prazoEntrega,
          producaoLinkToken: randomBytes(20).toString("base64url"),
          // Copia a URL como referência — o arquivo continua "pertencendo"
          // contabilmente ao orçamento (ArquivoArmazenado tipo
          // ARTE_ORCAMENTO), não cria uma linha nova de razão pro Pedido.
          // Se depois alguém remover a arte na Produção (removerArte),
          // removerArquivo({ tipo: "ARTE_PEDIDO" }) não vai achar nada e só
          // limpa pedido.arteUrl local, sem apagar o blob — comportamento
          // esperado.
          arteUrl: orcamento.arteUrl,
          // Mesmo arquivo copiado acima — copia os achados já calculados
          // junto, não recalcula (ver comentário de Pedido.preflightAvisos
          // no schema.prisma).
          preflightAvisos: orcamento.preflightAvisos ?? undefined,
        },
      });

      // Achado B1 — abre o apontamento da 1ª etapa (ARTE) na criação do
      // Pedido. Idempotente (ver comentário na função): necessário porque
      // este upsert roda de novo em toda re-submissão (duplo clique, retry).
      await abrirApontamentoInicialSeNecessario(tx, {
        graficaId: usuario.graficaId,
        pedidoId: pedido.id,
        origemConfirmacao: "APP",
      });

      // Congela aprovadoEm + os três snapshots + a previsão de custo por
      // categoria (PedidoCustoPrevisto) — ver fase-custo-real.md §2.3, §3.1
      // e src/lib/pedido-aprovacao.ts.
      await gravarPrevisaoAprovacaoPedido(tx, {
        graficaId: usuario.graficaId,
        orcamentoId,
        previsao: previsaoCusto,
      });

      // Candidata itens OFFSET pequenos demais pra encher uma chapa sozinhos
      // à fila de gang run (ver src/lib/gang-run-servico.ts) — mesma
      // transação que cria o Pedido, mesmo princípio de
      // gravarPrevisaoAprovacaoPedido logo acima.
      await registrarCandidatosGangRun(tx, {
        graficaId: usuario.graficaId,
        orcamentoId,
        pedidoId: pedido.id,
      });

      if (dadosComissao) {
        await tx.comissao.upsert({
          where: { orcamentoId },
          update: {},
          create: {
            graficaId: usuario.graficaId,
            orcamentoId,
            usuarioId: vendedorComissaoId,
            baseCalculo: dadosComissao.baseCalculo,
            percentualAplicado: percentualVendedor!,
            valorBase: dadosComissao.valorBase,
            valorComissao: dadosComissao.valorComissao,
          },
        });
        // Espelha a comissão em CustoPedido quando a gráfica optou por isso
        // (achado A1-Parte6 da auditoria de abrangência, 2026-08-24) — sem
        // preocupação extra de idempotência: o CAS acima já garante que este
        // bloco roda no máximo uma vez por orçamento.
        if (parametros?.comissaoEntraNoCustoPedido) {
          await criarCustoAutomaticoComissao(tx, {
            graficaId: usuario.graficaId,
            pedidoId: pedido.id,
            valorComissao: dadosComissao.valorComissao,
          });
        }
      }

      // Achado A13 — abate o valor escolhido do crédito adiantado do
      // cliente (ver CreditoCliente/MovimentacaoCreditoCliente no schema).
      // Roda por último, DENTRO desta mesma transação: se o saldo não
      // cobrir o valor pedido, o throw abaixo desfaz TUDO que já rodou
      // aqui em cima (Pedido, Comissao, etc.) — a aprovação não fica
      // "meio feita".
      if (usarCreditoValor) {
        const resultadoCredito = await lancarConsumoCreditoCliente(tx, {
          clienteId: orcamento.clienteId,
          orcamentoId,
          valor: usarCreditoValor,
          criadoPorId: usuario.id,
        });
        if (!resultadoCredito.ok) {
          throw new ErroCreditoClienteInsuficiente(resultadoCredito.mensagem);
        }
      }
      return true;
      });
    } catch (erro) {
      if (erro instanceof ErroCreditoClienteInsuficiente) {
        return { ok: false, mensagem: erro.message };
      }
      throw erro;
    }

    if (!aprovado) {
      return { ok: false, mensagem: "Este orçamento já teve o status alterado. Atualize a página." };
    }

    // Só dispara depois que a transação de aprovação acima realmente teve
    // sucesso (nunca em conflito de concorrência, já tratado pelo `if
    // (!aprovado)` logo acima). Avisa quem está configurado como responsável
    // pela emissão de NF-e (ver ResponsavelAdministrativo/AreaAdministrativa
    // no schema) — prepararNotificacaoNotaFiscal já retorna null quando
    // ninguém está configurado ou quando o orçamento ainda não está pronto
    // fiscalmente, então o `if` abaixo cobre os dois casos. Mesmo princípio
    // de melhor esforço do resto do projeto: dispararEventoEmail nunca
    // lança, e after() garante que a instância serverless continua viva até
    // o e-mail terminar de sair, mesmo depois da resposta já enviada.
    const notificacaoNotaFiscal = await prepararNotificacaoNotaFiscal(orcamentoId, usuario.graficaId);
    if (notificacaoNotaFiscal) {
      const origemNotaFiscal = await resolverOrigemPublica();
      const templateNotaFiscal = templateResponsavelNotaFiscal(
        notificacaoNotaFiscal.graficaNome,
        notificacaoNotaFiscal.clienteNome,
        orcamentoId,
        notificacaoNotaFiscal.valorTotal,
        `${origemNotaFiscal}/orcamento/${orcamentoId}`,
        notificacaoNotaFiscal.corPrimaria
      );
      for (const destinatario of notificacaoNotaFiscal.destinatarios) {
        after(() =>
          dispararEventoEmail({
            tipo: "responsavel_nota_fiscal",
            destinatario: destinatario.email,
            ...templateNotaFiscal,
          })
        );
      }
    }
  } else if (novoStatus === "REJEITADO") {
    // Nenhuma opção foi escolhida — mas o invariante "orçamento em status
    // terminal nunca tem OrcamentoOpcao" ainda precisa valer (ver
    // src/lib/orcamento-opcoes.ts). Base nunca é tocada. Precisa de
    // transação (a CAS sozinha, como as outras transições abaixo, não basta
    // mais aqui: tem uma segunda escrita condicionada ao mesmo sucesso).
    const rejeitado = await prisma.$transaction(async (tx) => {
      const cas = await tx.orcamento.updateMany({
        where: { id: orcamentoId, status: orcamento.status },
        data: { status: novoStatus },
      });
      if (cas.count === 0) return false;
      await descartarOpcoesAlternativas(tx, orcamentoId);
      return true;
    });
    if (!rejeitado) {
      return { ok: false, mensagem: "Este orçamento já teve o status alterado. Atualize a página." };
    }
  } else {
    // ENVIADO precisa da mesma validade calculada em gerarLinkPublico (só
    // um dos dois caminhos roda por transição, nunca os dois — CAS abaixo
    // continua sendo a única fonte de verdade sobre se a transição valeu).
    // RASCUNHO (reabertura por solicitarAjusteOrcamento) zera de volta —
    // sem isso, um orçamento reaberto continuaria com uma validoAteEm
    // órfã do envio anterior até o próximo reenvio recalcular. enviadoEm
    // segue o mesmo ciclo — é a âncora da lista de "orçamentos parados"
    // (ver orcamentoEstaParado em src/lib/orcamento-status.ts).
    const data: Prisma.OrcamentoUpdateManyMutationInput = { status: novoStatus };
    if (novoStatus === "ENVIADO") {
      const parametros = await prisma.parametrosGrafica.findUnique({
        where: { graficaId: usuario.graficaId },
        select: { diasValidadeOrcamentoPadrao: true, toleranciaTiragemPadraoPercent: true },
      });
      data.validoAteEm = new Date(
        Date.now() + (parametros?.diasValidadeOrcamentoPadrao ?? 15) * 86_400_000
      );
      data.enviadoEm = new Date();
      data.toleranciaTiragemPercent = parametros?.toleranciaTiragemPadraoPercent ?? 10;
    } else if (novoStatus === "RASCUNHO") {
      data.validoAteEm = null;
      data.enviadoEm = null;
      data.toleranciaTiragemPercent = null;
    }

    const cas = await prisma.orcamento.updateMany({
      where: { id: orcamentoId, status: orcamento.status },
      data,
    });
    if (cas.count === 0) {
      return { ok: false, mensagem: "Este orçamento já teve o status alterado. Atualize a página." };
    }
  }

  revalidatePath(`/orcamento/${orcamentoId}`);
  revalidatePath("/orcamento");
  if (novoStatus === "APROVADO") {
    revalidatePath("/producao");
    revalidatePath("/financeiro/comissoes");
  }

  // Compõe todos os avisos não-bloqueantes num único `aviso` (achado A9 +
  // achado A6 da Parte 4) em vez de um campo por causa — bloqueadoParaVenda,
  // bloqueadoParaFaturamento e estouro de limite de crédito são causas
  // independentes, mas todas cabem no mesmo Alert warning em OrcamentoAcoes.tsx.
  const avisos: string[] = [];
  if (novoStatus === "APROVADO") {
    if (orcamento.cliente.bloqueadoParaVenda) {
      avisos.push(
        `Atenção: este cliente está bloqueado para venda${
          orcamento.cliente.motivoBloqueio ? ` (${orcamento.cliente.motivoBloqueio})` : ""
        }. O orçamento foi aprovado mesmo assim — confira antes de seguir com a produção.`
      );
    }
    if (orcamento.cliente.bloqueadoParaFaturamento) {
      avisos.push(
        `Atenção: este cliente está bloqueado para faturamento${
          orcamento.cliente.motivoBloqueioFaturamento ? ` (${orcamento.cliente.motivoBloqueioFaturamento})` : ""
        }. O orçamento foi aprovado mesmo assim — confira antes de seguir com a produção.`
      );
    }
    if (avisoExcedeCredito) {
      avisos.push(avisoExcedeCredito);
    }
  }

  return {
    ok: true,
    mensagem: `Orçamento atualizado para ${ROTULOS_STATUS_ORCAMENTO[novoStatus]}.`,
    novoStatus,
    aviso: avisos.length > 0 ? avisos.join(" ") : undefined,
  };
}
