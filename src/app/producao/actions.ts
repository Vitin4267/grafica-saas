"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { Prisma } from "@/generated/prisma/client";
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
} from "@/lib/perda-fixa-producao";
import {
  validarArquivoArte,
  extensaoArte,
  assinaturaBateComTipo,
  BYTES_ASSINATURA,
} from "@/lib/upload-validacao";
import {
  resolverContextoArmazenamento,
  reservarEspaco,
  confirmarArquivo,
  cancelarReserva,
  removerArquivo,
} from "@/lib/billing/armazenamento";

export type AvancarPedidoResult = { ok: boolean; mensagem: string };

type StatusPedido = "FILA" | "IMPRESSAO" | "ACABAMENTO" | "PRONTO" | "ENTREGUE" | "CANCELADO";

const SEQUENCIA: StatusPedido[] = ["FILA", "IMPRESSAO", "ACABAMENTO", "PRONTO", "ENTREGUE"];

const ROTULOS: Record<StatusPedido, string> = {
  FILA: "Na fila",
  IMPRESSAO: "Impressão",
  ACABAMENTO: "Acabamento",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

const MENSAGEM_CONFLITO_CONCORRENTE =
  "Outra pessoa já avançou este pedido — recarregue a página e confira o status atual.";

// Sinaliza, de dentro da transação, que o status já mudou entre a leitura
// inicial e a escrita (duplo clique, duas abas, retry de rede) — usado só
// pra abortar com uma mensagem amigável. Não é um erro de banco de verdade.
class ErroPedidoJaAvancado extends Error {}

// Compartilhado entre previsaoBaixaEstoque (só leitura, pra montar a tela de
// confirmação) e avancarPedido (leitura + baixa de verdade) — mantém os dois
// call-sites com exatamente o mesmo formato de dado, evitando que a tela de
// confirmação mostre algo diferente do que de fato será descontado.
function buscarOrcamentoParaBaixa(orcamentoId: string) {
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

type ItemPrevisaoBaixa = {
  chave: string;
  materiaPrimaNome: string;
  varianteRotulo: string | null;
  quantidadeConsumida: number;
  perdaPadrao: number;
};

export type PrevisaoBaixaEstoqueResult =
  | { ok: false; mensagem: string }
  | { ok: true; itens: ItemPrevisaoBaixa[] };

// Leitura pura pra alimentar a tela de confirmação de "Iniciar impressão"
// (IniciarImpressaoConfirm.tsx) — replica os mesmos gates de avancarPedido
// (permissão, pedido precisa estar em FILA, arte aprovada) pra nunca abrir
// uma confirmação que seria rejeitada no submit de qualquer forma.
export async function previsaoBaixaEstoque(pedidoId: string): Promise<PrevisaoBaixaEstoqueResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.status !== "FILA") {
    return { ok: false, mensagem: "Este pedido não está na fila de impressão." };
  }
  if (pedido.arteUrl && !pedido.arteAprovadaEm) {
    return {
      ok: false,
      mensagem: "A arte precisa ser aprovada pelo cliente antes de iniciar a impressão.",
    };
  }

  const orcamentoComItens = await buscarOrcamentoParaBaixa(pedido.orcamentoId);

  const itens: ItemPrevisaoBaixa[] = [];
  for (const item of orcamentoComItens?.itens ?? []) {
    for (const ficha of item.itemGrafica.fichaTecnica) {
      // Mesma regra de avancarPedido: sem estoqueAtual configurado, esse
      // material não tem controle de estoque e não entra na baixa nem na perda.
      const estoqueAtual = ficha.variante ? ficha.variante.estoqueAtual : ficha.materiaPrima.estoqueAtual;
      if (estoqueAtual === null) continue;

      const perdaPadrao = ficha.variante ? ficha.variante.perdaFixaPadrao : ficha.materiaPrima.perdaFixaPadrao;
      itens.push({
        chave: montarChavePerda(item.id, ficha.id),
        materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
        varianteRotulo: ficha.variante?.rotulo ?? null,
        quantidadeConsumida: Number(ficha.quantidadePorUnidade) * item.quantidade,
        perdaPadrao: perdaPadrao !== null ? Number(perdaPadrao) : 0,
      });
    }
  }

  return { ok: true, itens };
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

export async function avancarPedido(
  _estadoAnterior: AvancarPedidoResult | null,
  formData: FormData
): Promise<AvancarPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }
  const pedidoId = String(formData.get("pedidoId"));

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    include: { orcamento: { include: { cliente: true } } },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

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

  const indiceAtual = SEQUENCIA.indexOf(pedido.status as StatusPedido);
  if (indiceAtual === -1) {
    // Defensivo: hoje inalcançável (status é enum do banco restrito aos 5
    // valores de SEQUENCIA), mas sem essa checagem um status fora da lista
    // faria SEQUENCIA[-1+1] resolver silenciosamente pra SEQUENCIA[0]
    // ("FILA") — regredindo o pedido em vez de dar erro.
    return { ok: false, mensagem: "Status do pedido inválido." };
  }
  if (indiceAtual === SEQUENCIA.length - 1) {
    return { ok: false, mensagem: "Este pedido já está no status final." };
  }

  const proximoStatus = SEQUENCIA[indiceAtual + 1];
  const statusAnterior = pedido.status;

  // Buscado uma única vez e reaproveitado pros dois tipos de evento disparados
  // abaixo (estoque_critico e pedido_status_mudou) — evita duas idas ao banco
  // só pra ler a mesma URL.
  const webhookUrl = await buscarWebhookAutomacao(usuario.graficaId);

  try {
    // Baixa automática de estoque: só na entrada em produção física (FILA→IMPRESSAO),
    // e só nessa transição específica. Sem mecanismo de estorno hoje: se o pedido for
    // descontinuado depois disso, a baixa não é desfeita automaticamente (limitação
    // conhecida).
    if (pedido.status === "FILA" && proximoStatus === "IMPRESSAO") {
      // Leitura só-consulta (ficha técnica não muda por causa de uma corrida
      // de avancarPedido) — fica FORA da transação de propósito, pra manter
      // a transação curta e reduzir chance de conflito de serialização.
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
            };
          })
      );

      // Teto de tamanho: não é o pedido que dita quantas linhas cabem aqui (ver
      // itensParaBaixa acima), é só uma trava contra um POST forjado com
      // milhares de chaves inventadas — extras já eram ignoradas, mas custavam
      // parse/validação de graça.
      const perdasParsed = parseJsonArray(formData.get("perdasJson"), linhaPerdaSchema, { max: 500 });
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
            where: { id: pedidoId, status: statusAnterior },
            data: { status: proximoStatus },
          });
          if (resultado.count === 0) {
            throw new ErroPedidoJaAvancado();
          }

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
              const estoqueDepois = calcularEstoqueDepois(Number(estoqueAtual), quantidadeConsumida, perdaAplicada);

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
              if (cruzouLimiteMinimo(Number(estoqueAtual), estoqueDepois, estoqueMinimo === null ? null : Number(estoqueMinimo))) {
                eventosEstoqueCritico.push({
                  itemNome: ficha.materiaPrima.itemCatalogo.nome,
                  estoqueAtual: estoqueDepois,
                  estoqueMinimo: Number(estoqueMinimo),
                });
              }
            }
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      if (webhookUrl) {
        for (const evento of eventosEstoqueCritico) {
          void dispararEventoAutomacao(webhookUrl, {
            tipo: "estoque_critico",
            graficaNome: usuario.grafica.nome,
            ...evento,
          });
        }
      }
    } else {
      // Mesmo guard de "só avança se o status ainda for o que a gente leu"
      // — aqui não é cumulativo como o desconto de estoque acima, mas sem
      // isso um duplo clique simplesmente re-confirmaria sucesso silencioso
      // numa transição que a outra requisição já tinha feito.
      const resultado = await prisma.pedido.updateMany({
        where: { id: pedidoId, status: statusAnterior },
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
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CONCORRENTE };
    }
    throw erro;
  }

  if (webhookUrl) {
    void dispararEventoAutomacao(webhookUrl, {
      tipo: "pedido_status_mudou",
      graficaNome: usuario.grafica.nome,
      clienteNome: pedido.orcamento.cliente.nome,
      clienteTelefone: normalizarTelefone(pedido.orcamento.cliente.telefone),
      statusAnterior,
      statusNovo: proximoStatus,
      orcamentoId: pedido.orcamentoId,
    });
  }

  revalidatePath("/producao");
  revalidatePath(`/orcamento/${pedido.orcamentoId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: `Avançado para ${ROTULOS[proximoStatus]}.` };
}

export type CancelarPedidoResult = { ok: boolean; mensagem: string };

const MENSAGEM_CONFLITO_CANCELAMENTO =
  "Outra pessoa já alterou este pedido — recarregue a página e confira o status atual.";

// Reaproveita a mesma ideia de ErroPedidoJaAvancado (sinalizar de dentro da
// transação que o status já não é mais o esperado), só com nome próprio pra
// não confundir os dois catch acima/abaixo.
class ErroPedidoJaAlterado extends Error {}

// Cancela um pedido em qualquer estágio ANTES de ENTREGUE (produto já saiu,
// cancelar não desfaz uma entrega física — ver comentário no enum
// StatusPedido) e, se ele já tinha passado por FILA→IMPRESSAO (baixa
// automática de estoque, ver avancarPedido acima), ESTORNA automaticamente
// a matéria-prima decrementada. Essa era a lacuna crítica documentada no
// comentário de avancarPedido: sem isso, cancelar um pedido em produção
// deixava o estoque permanentemente "faltando" material que na prática
// nunca foi usado.
export async function cancelarPedido(
  _estadoAnterior: CancelarPedidoResult | null,
  formData: FormData
): Promise<CancelarPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }
  const pedidoId = String(formData.get("pedidoId"));

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    include: { orcamento: { include: { cliente: true } } },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.status === "ENTREGUE") {
    return { ok: false, mensagem: "Um pedido já entregue não pode ser cancelado." };
  }
  if (pedido.status === "CANCELADO") {
    return { ok: false, mensagem: "Este pedido já está cancelado." };
  }

  const statusAnterior = pedido.status;
  const webhookUrl = await buscarWebhookAutomacao(usuario.graficaId);
  let itensEstornados = 0;

  try {
    await prisma.$transaction(
      async (tx) => {
        // Mesmo guard otimista de avancarPedido: updateMany com o status
        // ANTERIOR no where, não update por id — se outra requisição já
        // mudou o status entre a leitura acima e aqui (duplo clique, duas
        // abas), count vem 0 e abortamos em vez de cancelar/estornar em
        // cima de um estado que já não é mais o que a gente leu.
        const resultado = await tx.pedido.updateMany({
          where: { id: pedidoId, status: statusAnterior },
          data: { status: "CANCELADO" },
        });
        if (resultado.count === 0) {
          throw new ErroPedidoJaAlterado();
        }

        // Estorna pelo HISTÓRICO real de saídas (MovimentacaoEstoque), não
        // recalculando pela ficha técnica de novo — a ficha pode ter mudado
        // desde a baixa original, e o histórico é sempre a fonte da verdade
        // do que de fato foi decrementado. Se o pedido nunca saiu de FILA,
        // não existe nenhuma SAIDA pra este pedidoId e o loop não faz nada.
        const saidas = await tx.movimentacaoEstoque.findMany({
          where: { pedidoId, tipo: "SAIDA" },
        });
        itensEstornados = saidas.length;

        for (const saida of saidas) {
          if (saida.varianteId) {
            await tx.varianteMateriaPrima.update({
              where: { id: saida.varianteId },
              data: { estoqueAtual: { increment: saida.quantidade } },
            });
          } else {
            await tx.itemGrafica.update({
              where: { id: saida.itemGraficaId },
              data: { estoqueAtual: { increment: saida.quantidade } },
            });
          }
          await tx.movimentacaoEstoque.create({
            data: {
              itemGraficaId: saida.itemGraficaId,
              varianteId: saida.varianteId,
              pedidoId: pedido.id,
              tipo: "ENTRADA",
              quantidade: saida.quantidade,
              motivo: `Estorno por cancelamento do pedido ${pedido.id} (orçamento ${pedido.orcamentoId})`,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (erro) {
    if (erro instanceof ErroPedidoJaAlterado) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CANCELAMENTO };
    }
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO_CANCELAMENTO };
    }
    throw erro;
  }

  if (webhookUrl) {
    void dispararEventoAutomacao(webhookUrl, {
      tipo: "pedido_status_mudou",
      graficaNome: usuario.grafica.nome,
      clienteNome: pedido.orcamento.cliente.nome,
      clienteTelefone: normalizarTelefone(pedido.orcamento.cliente.telefone),
      statusAnterior,
      statusNovo: "CANCELADO",
      orcamentoId: pedido.orcamentoId,
    });
  }

  revalidatePath("/producao");
  revalidatePath(`/orcamento/${pedido.orcamentoId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");

  return {
    ok: true,
    mensagem:
      itensEstornados > 0
        ? "Pedido cancelado e estoque estornado."
        : "Pedido cancelado.",
  };
}

export type EnviarArteResult = { ok: boolean; mensagem: string };

// Sobe o arquivo de arte de um pedido pro Blob (access "public" — a arte é
// vista pelo cliente final através do link com token de qualquer forma, e
// não carrega segredo nenhum, ao contrário do dump de backup em
// src/app/api/cron/backup/route.ts). Reenvio (pedido já tinha uma arte)
// zera arteAprovadaEm/arteComentarioCliente — a aprovação/comentário
// anterior era sobre o arquivo antigo, não faz sentido continuar valendo
// pro novo. arteLinkToken é reaproveitado entre reenvios: o link que a
// gráfica já mandou pro cliente continua o mesmo.
export async function enviarArte(
  _estadoAnterior: EnviarArteResult | null,
  formData: FormData
): Promise<EnviarArteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const pedidoId = String(formData.get("pedidoId"));
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) {
    return { ok: false, mensagem: "Selecione um arquivo." };
  }
  const validacao = validarArquivoArte(arquivo);
  if (!validacao.ok) {
    return { ok: false, mensagem: validacao.mensagem };
  }
  // Confere a assinatura real do arquivo, não só o Content-Type declarado
  // pelo cliente (forjável) — ver comentário em upload-validacao.ts.
  const cabecalho = new Uint8Array(await arquivo.slice(0, BYTES_ASSINATURA).arrayBuffer());
  if (!assinaturaBateComTipo(cabecalho, arquivo.type)) {
    return { ok: false, mensagem: "O conteúdo do arquivo não corresponde a um PDF, JPG ou PNG." };
  }

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  // Reserva o espaço ANTES do put() — nunca depois, senão um upload rejeitado
  // por cota já teria custado o armazenamento (ver src/lib/billing/armazenamento.ts).
  const contextoArmazenamento = resolverContextoArmazenamento(usuario);
  const reserva = await reservarEspaco({
    graficaId: usuario.graficaId,
    tipo: "ARTE_PEDIDO",
    referenciaId: pedidoId,
    bytes: arquivo.size,
    contexto: contextoArmazenamento,
  });
  if (!reserva.ok) {
    return { ok: false, mensagem: reserva.mensagem };
  }

  const extensao = extensaoArte(arquivo.type);
  let blob;
  try {
    blob = await put(`pedidos-arte/${usuario.graficaId}/${pedidoId}-${Date.now()}.${extensao}`, arquivo, {
      access: "public",
      addRandomSuffix: true,
      contentType: arquivo.type,
    });
  } catch (erro) {
    await cancelarReserva(reserva.arquivoId);
    throw erro;
  }
  await confirmarArquivo(reserva.arquivoId, { url: blob.url, pathname: blob.pathname });

  const arteLinkToken = pedido.arteLinkToken ?? randomBytes(20).toString("base64url");

  await prisma.pedido.update({
    where: { id: pedidoId },
    data: {
      arteUrl: blob.url,
      arteLinkToken,
      arteAprovadaEm: null,
      arteComentarioCliente: null,
    },
  });

  // Apaga a arte anterior DEPOIS que a nova já está gravada no banco (melhor
  // esforço, igual salvarLogo em configuracoes/identidade/actions.ts). Sem
  // isso, cada reenvio deixava o arquivo antigo no Blob pra sempre, público e
  // sem nenhuma referência no banco — ou seja, sem nenhuma forma de achar ou
  // apagar depois. Além do custo de storage acumulado, é privacidade: arte de
  // cliente continuaria acessível por URL mesmo depois de substituída.
  if (pedido.arteUrl) {
    await del(pedido.arteUrl).catch(() => {});
  }

  revalidatePath("/producao");

  return { ok: true, mensagem: "Arte enviada! Copie o link abaixo e envie pro cliente aprovar." };
}

// Única forma de liberar o espaço ocupado por uma arte sem precisar
// substituí-la por outra — mesmos gates de enviarArte. Com arteUrl nulo, o
// gate de aprovação em avancarPedido volta a ficar inativo pra este pedido
// (é opt-in por pedido, não um bypass: se a gráfica quiser exigir aprovação
// de novo, basta enviar outra arte).
export async function removerArte(
  _estadoAnterior: EnviarArteResult | null,
  formData: FormData
): Promise<EnviarArteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const pedidoId = String(formData.get("pedidoId"));
  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (!pedido.arteUrl) {
    return { ok: false, mensagem: "Este pedido não tem arte enviada." };
  }

  await prisma.pedido.update({
    where: { id: pedidoId },
    data: { arteUrl: null, arteAprovadaEm: null, arteComentarioCliente: null },
  });

  const arquivoRemovido = await removerArquivo({
    graficaId: usuario.graficaId,
    tipo: "ARTE_PEDIDO",
    referenciaId: pedidoId,
  });
  if (arquivoRemovido) {
    await del(arquivoRemovido.url).catch(() => {});
  }

  revalidatePath("/producao");
  return { ok: true, mensagem: "Arte removida." };
}
