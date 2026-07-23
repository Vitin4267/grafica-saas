"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateArteAlteracaoSolicitada } from "@/lib/email/templates";

export type ResponderArteResult = { ok: boolean; mensagem: string };

const COMENTARIO_MAX = 2000;

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
    include: { orcamento: { include: { cliente: true, grafica: true } } },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Arte não encontrada." };
  }
  if (pedido.arteAprovadaEm) {
    return { ok: false, mensagem: "Esta arte já foi aprovada." };
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

    const donos = await prisma.usuario.findMany({
      where: { graficaId: pedido.graficaId, papel: "DONO" },
      select: { email: true },
    });
    if (donos.length > 0) {
      const origem = await resolverOrigemPublica();
      const { assunto, html, texto } = templateArteAlteracaoSolicitada(
        pedido.orcamento.grafica.nome,
        pedido.orcamento.cliente.nome,
        comentario,
        `${origem}/producao`
      );
      for (const dono of donos) {
        void dispararEventoEmail({
          tipo: "arte_alteracao_solicitada",
          destinatario: dono.email,
          assunto,
          html,
          texto,
        });
      }
    }
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
