"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo, podeConfirmarEstagio } from "@/lib/auth/permissoes";
import { Prisma } from "@/generated/prisma/client";
import { buscarWebhookAutomacao, dispararEventoAutomacao } from "@/lib/webhook-automacao";
import { normalizarTelefone } from "@/lib/telefone";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { montarChavePerda } from "@/lib/perda-fixa-producao";
import { avancarStatusPedido, buscarOrcamentoParaBaixa } from "./status-transicao";
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

// Autorização OR: PRODUCAO.podeEditar completo OU responsável atribuído
// pela etapa ATUAL do pedido (ver podeConfirmarEstagio) — por isso o pedido
// é buscado ANTES de decidir a permissão, ao contrário das outras actions
// deste arquivo. A transição em si (CAS, baixa de estoque condicional,
// webhooks, e-mail aos responsáveis da PRÓXIMA etapa) mora em
// avancarStatusPedido (./status-transicao.ts), compartilhada com a
// confirmação pública sem login em src/app/p/[token]/actions.ts.
export async function avancarPedido(
  _estadoAnterior: AvancarPedidoResult | null,
  formData: FormData
): Promise<AvancarPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  const pedidoId = String(formData.get("pedidoId"));

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    include: {
      orcamento: {
        include: {
          cliente: true,
          grafica: true,
          itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
        },
      },
    },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  if (!(await podeEditarModulo(usuario, "PRODUCAO")) && !(await podeConfirmarEstagio(usuario, pedido.status))) {
    return { ok: false, mensagem: "Você não tem permissão pra confirmar esta etapa." };
  }

  return avancarStatusPedido(pedido, formData.get("perdasJson"));
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
    // after() em vez de void: garante que a instância serverless continua
    // viva até o webhook terminar, mesmo depois da resposta já ter sido
    // enviada ao cliente.
    after(() =>
      dispararEventoAutomacao(webhookUrl, {
        tipo: "pedido_status_mudou",
        graficaNome: usuario.grafica.nome,
        clienteNome: pedido.orcamento.cliente.nome,
        clienteTelefone: normalizarTelefone(pedido.orcamento.cliente.telefone),
        statusAnterior,
        statusNovo: "CANCELADO",
        orcamentoId: pedido.orcamentoId,
      })
    );
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

export type CustoPedidoResult = { ok: boolean; mensagem: string };

// Lança um custo REAL (não estimado) num pedido — alimenta lucroDoPedido
// (src/lib/custo-pedido.ts) e o card de custos em PedidoLinha. Confere
// isolamento de tenant duas vezes: o pedido precisa pertencer à gráfica do
// usuário logado E a categoria também, senão um pedidoId/categoriaCustoId
// de outra gráfica vindo direto do form (sem passar pela UI) seria aceito.
export async function lancarCustoPedido(
  _estadoAnterior: CustoPedidoResult | null,
  formData: FormData
): Promise<CustoPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const pedidoId = String(formData.get("pedidoId"));
  const categoriaCustoId = String(formData.get("categoriaCustoId"));
  const valor = Number(formData.get("valor"));
  const observacao = String(formData.get("observacao") || "").trim().slice(0, 500) || null;

  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, mensagem: "Informe um valor maior que zero." };
  }

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  const categoria = await prisma.categoriaCusto.findFirst({
    where: { id: categoriaCustoId, graficaId: usuario.graficaId },
  });
  if (!categoria) {
    return { ok: false, mensagem: "Categoria de custo não encontrada." };
  }

  await prisma.custoPedido.create({
    data: {
      graficaId: usuario.graficaId,
      pedidoId,
      categoriaCustoId,
      valor,
      observacao,
    },
  });

  revalidatePath("/producao");
  revalidatePath("/meu-negocio");
  return { ok: true, mensagem: "Custo lançado." };
}

// Exclui um lançamento de custo real — mesma checagem de isolamento de
// tenant de lancarCustoPedido, agora sobre o próprio CustoPedido (que já
// guarda graficaId direto, ver comentário no schema).
export async function excluirCustoPedido(
  _estadoAnterior: CustoPedidoResult | null,
  formData: FormData
): Promise<CustoPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar a produção." };
  }

  const custoId = String(formData.get("custoId"));
  const custo = await prisma.custoPedido.findFirst({
    where: { id: custoId, graficaId: usuario.graficaId },
  });
  if (!custo) {
    return { ok: false, mensagem: "Custo não encontrado." };
  }

  await prisma.custoPedido.delete({ where: { id: custoId } });

  revalidatePath("/producao");
  revalidatePath("/meu-negocio");
  return { ok: true, mensagem: "Custo removido." };
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
  // A tela só mostra este formulário com status === "FILA", mas isso não é
  // proteção real — um POST direto pra esta action com o id de um pedido já
  // ENTREGUE/CANCELADO subiria arte, geraria link de aprovação novo e
  // zeraria arteAprovadaEm pra um pedido que já acabou (ver comentário sobre
  // defesa em profundidade em src/lib/auth/permissoes.ts).
  if (pedido.status !== "FILA") {
    return { ok: false, mensagem: "Só é possível enviar/remover arte enquanto o pedido está na fila." };
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
  // Mesmo gate de enviarArte acima: a tela só mostra o botão com
  // status === "FILA", mas isso não é proteção real por si só.
  if (pedido.status !== "FILA") {
    return { ok: false, mensagem: "Só é possível enviar/remover arte enquanto o pedido está na fila." };
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
