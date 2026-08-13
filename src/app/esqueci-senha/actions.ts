"use server";

import { z } from "zod";
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

    // `void` em vez de `await` (2026-07-26): a MENSAGEM já era idêntica nos
    // dois caminhos, mas o TEMPO não. E-mail inexistente respondia logo após
    // o findUnique; e-mail existente ainda esperava um fetch HTTPS completo
    // até o n8n (timeout de 5s) — dezenas a centenas de ms de diferença,
    // suficiente pra enumerar contas cronometrando a resposta, anulando todo
    // o cuidado da MENSAGEM_GENERICA. dispararEventoEmail já é melhor esforço
    // por dentro (nunca lança), então não aguardar não perde tratamento de
    // erro nenhum — mesmo padrão de void já usado em producao/actions.ts.
    void dispararEventoEmail({
      tipo: "reset_senha_solicitado",
      destinatario: email,
      assunto,
      html,
      texto,
    });
  }

  return { ok: true, mensagem: MENSAGEM_GENERICA };
}
