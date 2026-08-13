"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { dispararEventoEmail, type EventoEmail } from "@/lib/email/webhook-email";
import { templateArteAlteracaoSolicitada, templateArteAprovada } from "@/lib/email/templates";
import { tentarRegistrarRespostaArte } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";

export type ResponderArteResult = { ok: boolean; mensagem: string };

const COMENTARIO_MAX = 2000;

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
    void dispararEventoEmail({ tipo, destinatario: dono.email, ...template });
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
    // responderOrcamentoPublico.
    const resultado = await prisma.pedido.updateMany({
      where: { arteLinkToken: token, arteAprovadaEm: null },
      data: { arteAprovadaEm: new Date() },
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
      `${origem}/producao`
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
      data: { arteComentarioCliente: comentario },
    });
    if (resultado.count === 0) {
      return { ok: false, mensagem: "Esta arte já foi respondida." };
    }

    const origem = await resolverOrigemPublica();
    const template = templateArteAlteracaoSolicitada(
      pedido.orcamento.grafica.nome,
      pedido.orcamento.cliente.nome,
      comentario,
      `${origem}/producao`
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
