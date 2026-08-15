"use server";

import { z } from "zod";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { gerarTokenBruto, hashToken } from "@/lib/auth/session";
import { tentarRegistrarResetSenha } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { loginSchema } from "@/lib/auth/validation";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateResetSenha } from "@/lib/email/templates";

export type SolicitarResetResult = { ok: boolean; mensagem: string };

const emailSchema = z.object({ email: loginSchema.shape.email });

const TOKEN_DURACAO_MS = 1000 * 60 * 60; // 1 hora

// Mensagem SEMPRE igual, exista ou não o e-mail, e mesmo que o envio real
// falhe — mesmo princípio anti-enumeração já usado no login (HASH_FANTASMA):
// nunca revelar se uma conta existe através da resposta.
const MENSAGEM_GENERICA =
  "Se esse e-mail existir na nossa base, você vai receber um link de redefinição em instantes. Confira também a caixa de spam/lixo eletrônico.";

export async function solicitarResetSenha(
  _estadoAnterior: SolicitarResetResult | null,
  formData: FormData
): Promise<SolicitarResetResult> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "E-mail inválido." };
  }
  const { email } = parsed.data;
  const ip = await obterIpRequisicao();

  const MENSAGEM_BLOQUEIO = "Muitos pedidos de redefinição. Aguarde alguns minutos e tente novamente.";
  let bloqueado: boolean;
  try {
    bloqueado = await tentarRegistrarResetSenha(email, ip);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_BLOQUEIO };
    }
    throw erro;
  }
  if (bloqueado) {
    return { ok: false, mensagem: MENSAGEM_BLOQUEIO };
  }

  const usuario = await prisma.usuario.findUnique({
    where: { email },
    include: { grafica: { select: { corPrimaria: true } } },
  });

  if (usuario) {
    const tokenBruto = gerarTokenBruto();
    const tokenHash = hashToken(tokenBruto);
    const expiraEm = new Date(Date.now() + TOKEN_DURACAO_MS);

    await prisma.tokenResetSenha.create({
      data: { usuarioId: usuario.id, tokenHash, expiraEm },
    });

    const origem = await resolverOrigemPublica();
    const link = `${origem}/redefinir-senha?token=${tokenBruto}`;
    const { assunto, html, texto } = templateResetSenha(link, usuario.grafica.corPrimaria);

    // after() em vez de void/await (2026-07-26, atualizado 2026-08-13): a
    // MENSAGEM já era idêntica nos dois caminhos, mas o TEMPO não podia
    // depender de esperar o fetch até o n8n (timeout de 5s) só quando o
    // e-mail existe — isso daria pra enumerar contas cronometrando a
    // resposta, anulando o cuidado da MENSAGEM_GENERICA. after() resolve os
    // dois problemas de uma vez: a resposta sai imediatamente nos dois
    // caminhos (mesmo tempo), e — diferente do `void` puro — a instância
    // serverless continua viva até o e-mail terminar de enviar, em vez de
    // arriscar ser congelada no meio do fetch. dispararEventoEmail já é
    // melhor esforço por dentro (nunca lança).
    after(() =>
      dispararEventoEmail({
        tipo: "reset_senha_solicitado",
        destinatario: email,
        assunto,
        html,
        texto,
      })
    );
  }

  return { ok: true, mensagem: MENSAGEM_GENERICA };
}
