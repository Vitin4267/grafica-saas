"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
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
import { validarArquivoArte, extensaoArte } from "@/lib/upload-validacao";

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
      const orcamentoComItens = await prisma.orcamento.findUnique({
        where: { id: pedido.orcamentoId },
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
              const estoqueDepois = Number(estoqueAtual) - quantidadeConsumida;

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

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  const extensao = extensaoArte(arquivo.type);
  const blob = await put(`pedidos-arte/${pedidoId}-${Date.now()}.${extensao}`, arquivo, {
    access: "public",
    addRandomSuffix: true,
    contentType: arquivo.type,
  });

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

  revalidatePath("/producao");

  return { ok: true, mensagem: "Arte enviada! Copie o link abaixo e envie pro cliente aprovar." };
}
