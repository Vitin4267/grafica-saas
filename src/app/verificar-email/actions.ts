"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado, hashToken } from "@/lib/auth/session";
import {
  verificarBloqueioVerificacaoEmail,
  registrarTentativaVerificacaoEmail,
} from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { codigoVerificacaoValido } from "@/lib/auth/verificacao-email";
import { gerarEEnviarCodigoVerificacao } from "@/lib/email/verificacao-email";

export type VerificarCodigoResult = { ok: boolean; mensagem: string };

const codigoSchema = z.object({
  codigo: z.string().trim().regex(/^\d{6}$/, "Digite os 6 dígitos do código."),
});

// Mensagem genérica pra código errado/expirado/já usado/inexistente — não
// vale a pena distinguir esses casos pro usuário (todos pedem a mesma
// ação: peça um novo código), e evita dar pista sobre qual parte falhou.
const MENSAGEM_INVALIDO = "Código inválido ou expirado. Peça um novo.";

export async function verificarCodigo(
  _estadoAnterior: VerificarCodigoResult | null,
  formData: FormData
): Promise<VerificarCodigoResult> {
  const usuario = await exigirUsuarioAutenticado();
  if (usuario.emailVerificadoEm) {
    redirect("/orcamento");
  }

  const parsed = codigoSchema.safeParse({ codigo: formData.get("codigo") });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Código inválido." };
  }

  const token = await prisma.tokenVerificacaoEmail.findFirst({
    where: { usuarioId: usuario.id, usadoEm: null },
    orderBy: { createdAt: "desc" },
  });

  if (!token || !codigoVerificacaoValido(token)) {
    return { ok: false, mensagem: MENSAGEM_INVALIDO };
  }

  const codigoHash = hashToken(parsed.data.codigo);
  if (codigoHash !== token.codigoHash) {
    await prisma.tokenVerificacaoEmail.update({
      where: { id: token.id },
      data: { tentativas: { increment: 1 } },
    });
    return { ok: false, mensagem: MENSAGEM_INVALIDO };
  }

  await prisma.$transaction([
    prisma.tokenVerificacaoEmail.update({
      where: { id: token.id },
      data: { usadoEm: new Date() },
    }),
    prisma.usuario.update({
      where: { id: usuario.id },
      data: { emailVerificadoEm: new Date() },
    }),
  ]);

  redirect("/bem-vindo");
}

export async function reenviarCodigo(
  _estadoAnterior: VerificarCodigoResult | null,
  _formData: FormData
): Promise<VerificarCodigoResult> {
  const usuario = await exigirUsuarioAutenticado();
  if (usuario.emailVerificadoEm) {
    redirect("/orcamento");
  }

  const ip = await obterIpRequisicao();
  const bloqueado = await verificarBloqueioVerificacaoEmail(usuario.id, ip);
  if (bloqueado) {
    return {
      ok: false,
      mensagem: "Muitos pedidos de código. Aguarde alguns minutos e tente novamente.",
    };
  }

  await gerarEEnviarCodigoVerificacao(usuario);
  await registrarTentativaVerificacaoEmail(usuario.id, ip);

  return {
    ok: true,
    mensagem: "Enviamos um novo código pro seu e-mail. Confira também o spam/lixo eletrônico.",
  };
}
