"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth/session";
import { tokenResetValido } from "@/lib/auth/token-reset";
import { senhaSchema } from "@/lib/auth/validation";
import { hashPassword } from "@/lib/auth/password";

export type RedefinirSenhaResult = { ok: boolean; mensagem: string };

const MENSAGEM_LINK_INVALIDO = "Link inválido ou expirado. Peça um novo link de redefinição.";

const formSchema = z.object({
  token: z.string().min(1),
  senha: senhaSchema,
});

export async function redefinirSenha(
  _estadoAnterior: RedefinirSenhaResult | null,
  formData: FormData
): Promise<RedefinirSenhaResult> {
  const parsed = formSchema.safeParse({
    token: formData.get("token"),
    senha: formData.get("senha"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { token, senha } = parsed.data;

  const tokenHash = hashToken(token);
  const tokenReset = await prisma.tokenResetSenha.findUnique({ where: { tokenHash } });

  if (!tokenReset || !tokenResetValido(tokenReset)) {
    return { ok: false, mensagem: MENSAGEM_LINK_INVALIDO };
  }

  const senhaHash = await hashPassword(senha);

  await prisma.$transaction([
    prisma.usuario.update({
      where: { id: tokenReset.usuarioId },
      data: { senhaHash },
    }),
    prisma.tokenResetSenha.update({
      where: { id: tokenReset.id },
      data: { usadoEm: new Date() },
    }),
    // Se a senha vazou e havia sessão ativa, redefinir a senha derruba
    // esse acesso na hora — mesmo princípio de revogação já documentado
    // no model Sessao.
    prisma.sessao.deleteMany({ where: { usuarioId: tokenReset.usuarioId } }),
  ]);

  redirect("/login?senhaRedefinida=1");
}
