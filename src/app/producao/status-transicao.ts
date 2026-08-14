import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { StatusPedido } from "@/generated/prisma/enums";
import { buscarWebhookAutomacao, dispararEventoAutomacao } from "@/lib/webhook-automacao";
import { normalizarTelefone } from "@/lib/telefone";
import { cruzouLimiteMinimo } from "@/lib/estoque-critico";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { parseJsonArray } from "@/lib/form-json";
import {
  montarChavePerda,
  resolverPerdasConfirmadas,
  calcularEstoqueDepois,
  validarEstoqueSuficiente,
  chaveFisicaMaterial,
} from "@/lib/perda-fixa-producao";
import { SEQUENCIA_STATUS_PEDIDO, ROTULOS_STATUS_PEDIDO, ESTAGIOS_ATRIBUIVEIS } from "@/lib/producao-estagios";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateEstagioResponsavel } from "@/lib/email/templates";

// Núcleo compartilhado da transição de status de um Pedido — usado tanto
// por avancarPedido (autenticado, src/app/producao/actions.ts) quanto por
// confirmarEstagioPublico (sem login, src/app/p/[token]/actions.ts). NÃO
// faz autenticação/autorização — cada chamador decide separadamente se
// pode chamar isso; o que acontece depois de decidido é idêntico nos dois
// casos (CAS + baixa de estoque condicional + webhook de automação +
// e-mail aos responsáveis da PRÓXIMA etapa + revalidatePath).

export type PedidoParaAvanco = {
  id: string;
  graficaId: string;
  orcamentoId: string;
  status: StatusPedido;
  arteUrl: string | null;
  arteAprovadaEm: Date | null;
  producaoLinkToken: string | null;
  orcamento: {
    cliente: { nome: string; telefone: string | null };
    grafica: { nome: string };
    itens: { quantidade: number; itemGrafica: { itemCatalogo: { nome: string } } }[];
  };
};

export type AvancarStatusResult =
  | { ok: true; mensagem: string; statusAnterior: StatusPedido; proximoStatus: StatusPedido }
  | { ok: false; mensagem: string };

const MENSAGEM_CONFLITO_CONCORRENTE =
  "Outra pessoa já avançou este pedido — recarregue a página e confira o status atual.";

// Distinta de MENSAGEM_CONFLITO_CONCORRENTE de propósito: a leitura da ficha
// técnica/estoque roda FORA da transação Serializable (mantém a transação
// curta), então um erro de serialização aqui normalmente não é sobre ESTE
// pedido — é o Postgres abortando porque outro pedido, avançado ao mesmo
// tempo, mexeu no estoque do MESMO material físico (papel, chapa etc.)
// compartilhado entre os dois. Devolver a mensagem de "outra pessoa avançou
// este pedido" nesse caso confunde o operador: ele recarrega, vê o próprio
// pedido intocado, e a mensagem não bate com o que aconteceu.
const MENSAGEM_CONFLITO_MATERIAL_COMPARTILHADO =
  "Outro pedido usando o mesmo material foi processado ao mesmo tempo — tente novamente.";

// Sinaliza, de dentro da transação, que o status já mudou entre a leitura
// inicial e a escrita (duplo clique, duas abas, retry de rede) — usado só
// pra abortar com uma mensagem amigável. Não é um erro de banco de verdade.
class ErroPedidoJaAvancado extends Error {}

// Compartilhado entre previsaoBaixaEstoque (producao/actions.ts, só leitura,
// pra montar a tela de confirmação) e a baixa de verdade abaixo — mantém os
// dois call-sites com exatamente o mesmo formato de dado, evitando que a
// tela de confirmação mostre algo diferente do que de fato será descontado.
export function buscarOrcamentoParaBaixa(orcamentoId: string) {
  return prisma.orcamento.findUnique({
    where: { id: orcamentoId },
    include: {
      itens: {
        include: {
          itemGrafica: {
            include: {
              fichaTecnica: {
                include: {
                  materiaPrima: { include: { itemCatalogo: true } },
                  variante: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

// 1 milhão numa única linha é um teto "irreal" de propósito — nenhuma perda
// de calibragem de verdade chega perto disso, então ele só existe pra pegar
// erro de digitação grosseiro (ex: um zero a mais) sem incomodar o uso normal.
const PERDA_MAXIMA = 1_000_000;

const linhaPerdaSchema = z.object({
  chave: z.string().min(1),
  perdaAplicada: z.coerce
    .number()
    .finite("Valor de perda inválido.")
    .min(0, "Perda aplicada não pode ser negativa.")
    .max(PERDA_MAXIMA, `Perda aplicada não pode passar de ${PERDA_MAXIMA.toLocaleString("pt-BR")}.`),
});

export async function avancarStatusPedido(
  pedido: PedidoParaAvanco,
  perdasJsonBruto: FormDataEntryValue | null
): Promise<AvancarStatusResult> {
  // Gate opt-in: só bloqueia se ESTA gráfica enviou uma arte pra este
  // pedido (arteUrl preenchido) — pedidos sem arte enviada avançam
  // normalmente, sem exigir nada novo. Uma vez enviada, exige aprovação do
  // cliente (ver /a/[token]) antes de sair de FILA.
  if (pedido.status === "FILA" && pedido.arteUrl && !pedido.arteAprovadaEm) {
    return {
      ok: false,
      mensagem: "A arte precisa ser aprovada pelo cliente antes de iniciar a impressão.",
    };
  }

  const indiceAtual = SEQUENCIA_STATUS_PEDIDO.indexOf(pedido.status);
  if (indiceAtual === -1) {
    // Defensivo: hoje inalcançável (status é enum do banco restrito aos 5
    // valores de SEQUENCIA_STATUS_PEDIDO), mas sem essa checagem um status
    // fora da lista faria [-1+1] resolver silenciosamente pro índice 0
    // ("FILA") — regredindo o pedido em vez de dar erro.
    return { ok: false, mensagem: "Status do pedido inválido." };
  }
  if (indiceAtual === SEQUENCIA_STATUS_PEDIDO.length - 1) {
    return { ok: false, mensagem: "Este pedido já está no status final." };
  }

  const proximoStatus = SEQUENCIA_STATUS_PEDIDO[indiceAtual + 1];
  const statusAnterior = pedido.status;

  // Buscado uma única vez e reaproveitado pro evento pedido_status_mudou
  // abaixo.
  const webhookUrl = await buscarWebhookAutomacao(pedido.graficaId);

  try {
    // Baixa automática de estoque: só na entrada em produção física (FILA→IMPRESSAO),
    // e só nessa transição específica. Sem mecanismo de estorno automático aqui —
    // ver cancelarPedido em producao/actions.ts, que cobre isso.
    if (pedido.status === "FILA" && proximoStatus === "IMPRESSAO") {
      // Leitura só-consulta (ficha técnica não muda por causa de uma corrida
      // desta função) — fica FORA da transação de propósito, pra manter a
      // transação curta e reduzir chance de conflito de serialização.
      const orcamentoComItens = await buscarOrcamentoParaBaixa(pedido.orcamentoId);

      // Mesma granularidade (item do orçamento × item da ficha técnica) que
      // previsaoBaixaEstoque mostra na tela de confirmação — precisa bater
      // exatamente pra validar que a confirmação enviada cobre tudo que vai
      // ser descontado.
      const itensParaBaixa = (orcamentoComItens?.itens ?? []).flatMap((item) =>
        item.itemGrafica.fichaTecnica
          .filter(
            (ficha) =>
              (ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual) !== null
          )
          .map((ficha) => {
            const perdaPadrao = ficha.variante
              ? ficha.variante.perdaFixaPadrao
              : ficha.materiaPrima.perdaFixaPadrao;
            const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
            return {
              chave: montarChavePerda(item.id, ficha.id),
              quantidadeConsumida: Number(ficha.quantidadePorUnidade) * item.quantidade,
              perdaPadrao: perdaPadrao !== null ? Number(perdaPadrao) : 0,
              estoqueAtual: Number(estoqueAtual),
              materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
              // Identidade física do material (ver chaveFisicaMaterial em
              // perda-fixa-producao.ts) — necessária pra agregar as linhas
              // ANTES de validar quando dois produtos deste orçamento usam o
              // mesmo material.
              materiaPrimaId: ficha.materiaPrimaId,
              varianteId: ficha.varianteId,
            };
          })
      );

      // Teto de tamanho: não é o pedido que dita quantas linhas cabem aqui (ver
      // itensParaBaixa acima), é só uma trava contra um POST forjado com
      // milhares de chaves inventadas — extras já eram ignoradas, mas custavam
      // parse/validação de graça.
      const perdasParsed = parseJsonArray(perdasJsonBruto, linhaPerdaSchema, { max: 500 });
      if (!perdasParsed.ok) {
        return { ok: false, mensagem: perdasParsed.mensagem };
      }
      // Decisão de negócio: se a confirmação não cobrir todo mundo, bloqueia a
      // transição inteira antes de mexer no banco — nunca aplica um padrão
      // silenciosamente nem processa parcialmente (ver perda-fixa-producao.ts).
      const resolucaoPerdas = resolverPerdasConfirmadas(itensParaBaixa, perdasParsed.data);
      if (!resolucaoPerdas.ok) {
        return { ok: false, mensagem: resolucaoPerdas.mensagem };
      }
      const perdasPorChave = resolucaoPerdas.porChave;

      // Confere ANTES da transação que consumo + perda não deixa nenhum
      // material negativo — pega tanto um valor de perda digitado errado
      // quanto uma ficha técnica pedindo mais do que existe.
      const validacaoEstoque = validarEstoqueSuficiente(itensParaBaixa, perdasPorChave);
      if (!validacaoEstoque.ok) {
        return { ok: false, mensagem: validacaoEstoque.mensagem };
      }

      // Coletado durante o loop e disparado só DEPOIS que a transação confirmar
      // — evita mandar aviso de estoque crítico pra uma baixa que pode não ter
      // sido de fato persistida.
      const eventosEstoqueCritico: { itemNome: string; estoqueAtual: number; estoqueMinimo: number }[] = [];

      await prisma.$transaction(
        async (tx) => {
          // updateMany com o status ANTERIOR no where (não um update simples
          // por id) é o que impede duplo clique/duas abas/retry de rede
          // descontarem o estoque duas vezes: se outra requisição concorrente
          // já mudou o status entre a leitura lá em cima e aqui, count vem 0
          // e abortamos — em vez de decrementar de novo por cima de um pedido
          // que já não está mais em FILA.
          const resultado = await tx.pedido.updateMany({
            where: { id: pedido.id, status: statusAnterior },
            data: { status: proximoStatus },
          });
          if (resultado.count === 0) {
            throw new ErroPedidoJaAvancado();
          }

          // Acumula o decremento TOTAL por material FÍSICO (varianteId ??
          // materiaPrimaId, ver chaveFisicaMaterial) enquanto o loop roda —
          // quando dois produtos deste orçamento consomem o mesmo material,
          // cruzouLimiteMinimo só pode ser avaliado depois de somar as duas
          // linhas; avaliando linha a linha ele podia disparar (ou deixar de
          // disparar) o alerta usando o estoqueDepois de uma baixa isolada,
          // que não reflete onde o estoque de fato ficou ao final da
          // transição inteira.
          const acumuladoPorMaterial = new Map<
            string,
            { estoqueAtual: number; estoqueMinimo: number | null; materiaPrimaNome: string; totalDecremento: number }
          >();

          for (const item of orcamentoComItens?.itens ?? []) {
            for (const ficha of item.itemGrafica.fichaTecnica) {
              // Com variante (ex: espessura de chapa), o saldo de estoque é o da
              // variante, não o do ItemGrafica "pai" — cada variante é fisicamente
              // um estoque separado. Sem variante, comportamento de sempre.
              const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
              if (estoqueAtual === null) continue; // sem controle de estoque
              const quantidadeConsumida = Number(ficha.quantidadePorUnidade) * item.quantidade;
              // Validado antes da transação (resolverPerdasConfirmadas) — toda
              // chave esperada aqui já tem confirmação, o "!" é seguro.
              const chave = montarChavePerda(item.id, ficha.id);
              const perdaAplicada = perdasPorChave.get(chave)!;

              if (ficha.varianteId) {
                await tx.varianteMateriaPrima.update({
                  where: { id: ficha.varianteId },
                  data: { estoqueAtual: { decrement: quantidadeConsumida } },
                });
              } else {
                await tx.itemGrafica.update({
                  where: { id: ficha.materiaPrimaId },
                  data: { estoqueAtual: { decrement: quantidadeConsumida } },
                });
              }
              await tx.movimentacaoEstoque.create({
                data: {
                  itemGraficaId: ficha.materiaPrimaId,
                  varianteId: ficha.varianteId,
                  pedidoId: pedido.id,
                  tipo: "SAIDA",
                  quantidade: quantidadeConsumida,
                  motivo: `Produção do pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
                },
              });

              // Movimentação SEPARADA da baixa por ficha técnica acima (não soma
              // no mesmo registro) — assim cancelarPedido, que já reverte TODA
              // saída encontrada pelo pedidoId sem filtrar por motivo, estorna as
              // duas automaticamente sem precisar de nenhuma mudança lá.
              if (perdaAplicada > 0) {
                if (ficha.varianteId) {
                  await tx.varianteMateriaPrima.update({
                    where: { id: ficha.varianteId },
                    data: { estoqueAtual: { decrement: perdaAplicada } },
                  });
                } else {
                  await tx.itemGrafica.update({
                    where: { id: ficha.materiaPrimaId },
                    data: { estoqueAtual: { decrement: perdaAplicada } },
                  });
                }
                await tx.movimentacaoEstoque.create({
                  data: {
                    itemGraficaId: ficha.materiaPrimaId,
                    varianteId: ficha.varianteId,
                    pedidoId: pedido.id,
                    tipo: "SAIDA",
                    quantidade: perdaAplicada,
                    motivo: `Perda fixa de calibragem — pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
                  },
                });
              }

              const estoqueMinimo = ficha.variante ? ficha.variante.estoqueMinimo : ficha.materiaPrima.estoqueMinimo;
              const chaveFisica = chaveFisicaMaterial(ficha);
              const decrementoLinha = quantidadeConsumida + perdaAplicada;
              const existente = acumuladoPorMaterial.get(chaveFisica);
              if (existente) {
                existente.totalDecremento += decrementoLinha;
              } else {
                acumuladoPorMaterial.set(chaveFisica, {
                  estoqueAtual: Number(estoqueAtual),
                  estoqueMinimo: estoqueMinimo === null ? null : Number(estoqueMinimo),
                  materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
                  totalDecremento: decrementoLinha,
                });
              }
            }
          }

          // Avaliado uma única vez por material FÍSICO, depois de somar todas
          // as linhas que caem nele — não mais dentro do loop acima.
          for (const acumulado of acumuladoPorMaterial.values()) {
            const estoqueDepois = calcularEstoqueDepois(acumulado.estoqueAtual, acumulado.totalDecremento, 0);
            if (cruzouLimiteMinimo(acumulado.estoqueAtual, estoqueDepois, acumulado.estoqueMinimo)) {
              eventosEstoqueCritico.push({
                itemNome: acumulado.materiaPrimaNome,
                estoqueAtual: estoqueDepois,
                estoqueMinimo: acumulado.estoqueMinimo ?? 0,
              });
            }
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      if (webhookUrl) {
        for (const evento of eventosEstoqueCritico) {
          // after() em vez de void: garante que a instância serverless
          // continua viva até o webhook terminar, mesmo depois da resposta
          // já ter sido enviada ao cliente.
          after(() =>
            dispararEventoAutomacao(webhookUrl, {
              tipo: "estoque_critico",
              graficaNome: pedido.orcamento.grafica.nome,
              ...evento,
            })
          );
        }
      }
    } else {
      // Mesmo guard de "só avança se o status ainda for o que a gente leu"
      // — aqui não é cumulativo como o desconto de estoque acima, mas sem
      // isso um duplo clique simplesmente re-confirmaria sucesso silencioso
      // numa transição que a outra requisição já tinha feito.
      const resultado = await prisma.pedido.updateMany({
        where: { id: pedido.id, status: statusAnterior },
        data: { status: proximoStatus },
      });
      if (resultado.count === 0) {
        throw new ErroPedidoJaAvancado();
      }
    }
  } catch (erro) {
    if (erro instanceof ErroPedidoJaAvancado) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_MATERIAL_COMPARTILHADO };
    }
    throw erro;
  }

  if (webhookUrl) {
    // after() em vez de void: garante que a instância serverless continua
    // viva até o webhook terminar, mesmo depois da resposta já ter sido
    // enviada ao cliente.
    after(() =>
      dispararEventoAutomacao(webhookUrl, {
        tipo: "pedido_status_mudou",
        graficaNome: pedido.orcamento.grafica.nome,
        clienteNome: pedido.orcamento.cliente.nome,
        clienteTelefone: normalizarTelefone(pedido.orcamento.cliente.telefone),
        statusAnterior,
        statusNovo: proximoStatus,
        orcamentoId: pedido.orcamentoId,
      })
    );
  }

  // E-mail aos responsáveis pela etapa que o pedido acabou de ENTRAR — só
  // pras 3 etapas atribuíveis (ver ESTAGIOS_ATRIBUIVEIS); ENTREGUE nunca
  // dispara isso porque não há mais nenhuma transição a confirmar depois.
  if (ESTAGIOS_ATRIBUIVEIS.some((estagio) => estagio.valor === proximoStatus)) {
    const responsaveis = await prisma.usuario.findMany({
      where: { graficaId: pedido.graficaId, responsaveisEstagio: { some: { status: proximoStatus } } },
      select: { email: true },
    });
    if (responsaveis.length > 0) {
      // Backfill lazy: pedidos criados antes desta feature não têm token
      // ainda. Pedidos novos já nascem com ele (ver criação do Pedido em
      // orcamento/[id]/actions.ts e o/[token]/actions.ts).
      let token = pedido.producaoLinkToken;
      if (!token) {
        token = randomBytes(20).toString("base64url");
        await prisma.pedido.update({ where: { id: pedido.id }, data: { producaoLinkToken: token } });
      }
      const origem = await resolverOrigemPublica();
      const link = `${origem}/p/${token}`;
      const itensResumo = pedido.orcamento.itens.map((item) => ({
        nome: item.itemGrafica.itemCatalogo.nome,
        quantidade: item.quantidade,
      }));
      const template = templateEstagioResponsavel(
        pedido.orcamento.grafica.nome,
        pedido.orcamento.cliente.nome,
        ROTULOS_STATUS_PEDIDO[proximoStatus],
        itensResumo,
        link
      );
      for (const responsavel of responsaveis) {
        // after() em vez de void: garante que a instância serverless
        // continua viva até o e-mail terminar, mesmo depois da resposta já
        // ter sido enviada ao cliente.
        after(() =>
          dispararEventoEmail({ tipo: "estagio_responsavel", destinatario: responsavel.email, ...template })
        );
      }
    }
  }

  revalidatePath("/producao");
  revalidatePath(`/orcamento/${pedido.orcamentoId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");

  return {
    ok: true,
    mensagem: `Avançado para ${ROTULOS_STATUS_PEDIDO[proximoStatus]}.`,
    statusAnterior,
    proximoStatus,
  };
}
