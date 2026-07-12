"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { gerarTokenBruto, hashToken } from "@/lib/auth/session";
import { verificarBloqueioResetSenha, registrarTentativaResetSenha } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
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
  "Se esse e-mail existir na nossa base, você vai receber um link de redefinição em instantes.";

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

  const bloqueado = await verificarBloqueioResetSenha(email, ip);
  if (bloqueado) {
    return {
      ok: false,
      mensagem: "Muitos pedidos de redefinição. Aguarde alguns minutos e tente novamente.",
    };
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });

  if (usuario) {
    const tokenBruto = gerarTokenBruto();
    const tokenHash = hashToken(tokenBruto);
    const expiraEm = new Date(Date.now() + TOKEN_DURACAO_MS);

    await prisma.tokenResetSenha.create({
      data: { usuarioId: usuario.id, tokenHash, expiraEm },
    });

    const origem = await resolverOrigemPublica();
    const link = `${origem}/redefinir-senha?token=${tokenBruto}`;
    const { assunto, html, texto } = templateResetSenha(link);

    // dispararEventoEmail já é melhor esforço por dentro (nunca lança) —
    // reforça o mesmo princípio aqui: falha de envio não pode vazar
    // diferença na resposta em relação ao caminho "e-mail não existe"
    // (ver MENSAGEM_GENERICA).
    await dispararEventoEmail({
      tipo: "reset_senha_solicitado",
      destinatario: email,
      assunto,
      html,
      texto,
    });
  }

  await registrarTentativaResetSenha(email, ip);

  return { ok: true, mensagem: MENSAGEM_GENERICA };
}
