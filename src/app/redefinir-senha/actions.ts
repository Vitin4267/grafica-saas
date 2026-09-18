"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth/session";
import { tokenResetValido } from "@/lib/auth/token-reset";
import { senhaSchema } from "@/lib/auth/validation";
import { hashPassword } from "@/lib/auth/password";
import { semTenant } from "@/lib/tenant-context";

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

  // semTenant (achado real de produção 2026-09-18, mesma categoria de
  // login/esqueci-senha) — link de reset é acessado sem sessão nenhuma;
  // ninguém chamou definirTenantAtual nesta cadeia. Sem isso o
  // prisma.usuario.update abaixo não acha a linha sob RLS (Usuario ativo
  // desde o lote 2) e explode com "Record not found".
  await semTenant("redefinir senha via token — sem sessão, tenant desconhecido", () =>
    prisma.$transaction([
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
    ])
  );

  redirect("/login?senhaRedefinida=1");
}
