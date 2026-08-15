"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { dispararEventoEmail, type EventoEmail } from "@/lib/email/webhook-email";
import { templateArteAlteracaoSolicitada, templateArteAprovada } from "@/lib/email/templates";
import { tentarRegistrarRespostaArte } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { assinaturaEstaLiberada } from "@/lib/billing/status";

export type ResponderArteResult = { ok: boolean; mensagem: string };

const COMENTARIO_MAX = 2000;
const NOME_MAX = 200;

// Compartilhado pelos dois avisos que este arquivo dispara (aprovação e
// pedido de alteração) — mesmo destinatário (DONO(s) da gráfica) nos dois
// casos, só muda o template/tipo.
async function notificarDonos(
  graficaId: string,
  tipo: EventoEmail["tipo"],
  template: { assunto: string; html: string; texto: string }
) {
  const donos = await prisma.usuario.findMany({
    where: { graficaId, papel: "DONO" },
    select: { email: true },
  });
  for (const dono of donos) {
    // after() em vez de void: em serverless (Vercel) a instância pode ser
    // congelada assim que a resposta é enviada, antes do fetch do `void`
    // terminar — after() garante que a instância continua viva até o
    // callback terminar. Ver AGENTS.md/node_modules/next/dist/docs/.../after.md.
    after(() => dispararEventoEmail({ tipo, destinatario: dono.email, ...template }));
  }
}

// Sem autenticação: o próprio token é o "credencial", mesmo princípio de
// src/app/o/[token]/actions.ts:9 — dá acesso de leitura/decisão só sobre
// ESTE pedido, nunca sobre a conta da gráfica.
export async function responderArtePublica(
  _estadoAnterior: ResponderArteResult | null,
  formData: FormData
): Promise<ResponderArteResult> {
  const token = String(formData.get("token"));
  const decisao = String(formData.get("decisao"));

  if (decisao !== "APROVADA" && decisao !== "ALTERACAO") {
    return { ok: false, mensagem: "Ação inválida." };
  }

  // Nome DECLARADO por quem responde — não verificado (ver comentário de
  // Pedido.arteRespondidaPor no schema, mesmo princípio de
  // o/[token]/actions.ts). Disputa de arte custa mais caro que disputa de
  // preço ("eu nunca aprovei essa cor"), por isso obrigatório nos dois
  // caminhos, não só na aprovação.
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe seu nome pra confirmar." };
  }
  if (nome.length > NOME_MAX) {
    return { ok: false, mensagem: "Nome muito longo — use até 200 caracteres." };
  }

  const pedido = await prisma.pedido.findUnique({
    where: { arteLinkToken: token },
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
    return { ok: false, mensagem: "Arte não encontrada." };
  }
  if (pedido.arteAprovadaEm) {
    return { ok: false, mensagem: "Esta arte já foi aprovada." };
  }

  // Furo de paywall (achado de revisão de código): o link público é evergreen
  // e nunca expira por design, então uma gráfica com assinatura cancelada
  // (bloqueada no app autenticado) continuava deixando o cliente final
  // aprovar arte por aqui, de graça. Mesmo padrão de confirmarEstagioPublico
  // (src/app/p/[token]/actions.ts) e de responderOrcamentoPublico
  // (src/app/o/[token]/actions.ts): sem sessão de usuário aqui, busca a
  // assinatura da gráfica DONA do pedido pelo graficaId e aplica
  // assinaturaEstaLiberada direto, devolvendo erro amigável sem detalhe de
  // billing. Antes do rate limit e dos updateMany: falha rápido, sem gastar
  // tentativa do rate limit nem escrever no banco à toa.
  const assinatura = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId: pedido.graficaId },
  });
  if (!assinaturaEstaLiberada(assinatura)) {
    return {
      ok: false,
      mensagem: "A assinatura desta gráfica não está ativa no momento — não é possível responder por aqui.",
    };
  }

  // Rate limit (achado da auditoria de 2026-07-26): quem tem o link consegue
  // chamar esta action sem limite nenhum — "aprovar" trava sozinho na
  // primeira vez (arteAprovadaEm), mas "pedir alteração" não, e cada chamada
  // dispara um e-mail novo pro(s) DONO(s) da gráfica via um webhook
  // compartilhado com TODOS os tenants. Aplicado nos dois branches, não só
  // no de alteração, por simplicidade e porque protege também contra spam de
  // escrita no banco. Ver src/lib/auth/rate-limit.ts.
  const ip = await obterIpRequisicao();
  let bloqueado: boolean;
  try {
    bloqueado = await tentarRegistrarRespostaArte(pedido.id, ip);
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

  if (decisao === "APROVADA") {
    // CAS: só aprova se ainda não tinha sido aprovada — evita duplo
    // processamento (duas abas, clique duplo), mesmo padrão de
    // responderOrcamentoPublico. arteRespondidaPor grava na MESMA operação
    // que arteAprovadaEm — nunca num update solto depois, senão dá pra ter
    // arte aprovada sem nenhum nome associado.
    const resultado = await prisma.pedido.updateMany({
      where: { arteLinkToken: token, arteAprovadaEm: null },
      data: { arteAprovadaEm: new Date(), arteRespondidaPor: nome },
    });
    if (resultado.count === 0) {
      return { ok: false, mensagem: "Esta arte já foi respondida." };
    }

    const origem = await resolverOrigemPublica();
    const template = templateArteAprovada(
      pedido.orcamento.grafica.nome,
      pedido.orcamento.cliente.nome,
      pedido.orcamento.itens.map((item) => ({
        nome: item.itemGrafica.itemCatalogo.nome,
        quantidade: item.quantidade,
      })),
      `${origem}/producao`,
      pedido.orcamento.grafica.corPrimaria
    );
    await notificarDonos(pedido.graficaId, "arte_aprovada", template);
  } else {
    const comentario = String(formData.get("comentario") ?? "").trim();
    if (!comentario) {
      return { ok: false, mensagem: "Descreva a alteração que você precisa." };
    }
    if (comentario.length > COMENTARIO_MAX) {
      return { ok: false, mensagem: "Comentário muito longo — resuma em até 2000 caracteres." };
    }

    const resultado = await prisma.pedido.updateMany({
      where: { arteLinkToken: token, arteAprovadaEm: null },
      data: { arteComentarioCliente: comentario, arteRespondidaPor: nome },
    });
    if (resultado.count === 0) {
      return { ok: false, mensagem: "Esta arte já foi respondida." };
    }

    const origem = await resolverOrigemPublica();
    const template = templateArteAlteracaoSolicitada(
      pedido.orcamento.grafica.nome,
      pedido.orcamento.cliente.nome,
      comentario,
      `${origem}/producao`,
      pedido.orcamento.grafica.corPrimaria
    );
    await notificarDonos(pedido.graficaId, "arte_alteracao_solicitada", template);
  }

  revalidatePath(`/a/${token}`);
  revalidatePath("/producao");

  return {
    ok: true,
    mensagem:
      decisao === "APROVADA"
        ? "Arte aprovada! A gráfica já pode seguir pra impressão."
        : "Pedido de alteração enviado pra gráfica.",
  };
}
