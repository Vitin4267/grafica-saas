"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado, hashToken } from "@/lib/auth/session";
import { tentarRegistrarVerificacaoEmail } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { codigoVerificacaoValido, LIMITE_TENTATIVAS } from "@/lib/auth/verificacao-email";
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

  // Reserva um palpite de forma ATÔMICA antes de comparar o código: o
  // updateMany só afeta a linha se ela ainda estiver válida E abaixo do
  // limite, e o WHERE+increment num único statement serializa palpites
  // concorrentes no banco. Sem isso, N requisições paralelas liam
  // "tentativas < 5" ao mesmo tempo, todas passavam, e o limite de 5 palpites
  // (única defesa contra força bruta do código de 6 dígitos) era furado
  // disparando lotes em paralelo. count === 0 = limite estourado / expirou /
  // foi usado nesse meio-tempo.
  const reserva = await prisma.tokenVerificacaoEmail.updateMany({
    where: {
      id: token.id,
      usadoEm: null,
      expiraEm: { gt: new Date() },
      tentativas: { lt: LIMITE_TENTATIVAS },
    },
    data: { tentativas: { increment: 1 } },
  });
  if (reserva.count === 0) {
    return { ok: false, mensagem: MENSAGEM_INVALIDO };
  }

  const codigoHash = hashToken(parsed.data.codigo);
  if (codigoHash !== token.codigoHash) {
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
  const MENSAGEM_BLOQUEIO = "Muitos pedidos de código. Aguarde alguns minutos e tente novamente.";
  let bloqueado: boolean;
  try {
    bloqueado = await tentarRegistrarVerificacaoEmail(usuario.id, ip);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_BLOQUEIO };
    }
    throw erro;
  }
  if (bloqueado) {
    return { ok: false, mensagem: MENSAGEM_BLOQUEIO };
  }

  await gerarEEnviarCodigoVerificacao(usuario);

  return {
    ok: true,
    mensagem: "Enviamos um novo código pro seu e-mail. Confira também o spam/lixo eletrônico.",
  };
}
