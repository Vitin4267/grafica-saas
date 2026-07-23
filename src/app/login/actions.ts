"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { criarSessao } from "@/lib/auth/session";
import { reservarTentativaLogin, confirmarTentativaLoginBemSucedida } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { loginSchema } from "@/lib/auth/validation";
import { verificarTurnstile } from "@/lib/turnstile";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";

const MENSAGEM_BLOQUEIO = "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.";

export type LoginResult = {
  ok: boolean;
  mensagem: string;
};

const MENSAGEM_GENERICA = "E-mail ou senha inválidos.";

// Hash "dummy" verificado quando o e-mail não existe, para que o tempo de resposta
// não entregue (por timing) se a conta existe ou não.
const HASH_FANTASMA =
  "$argon2id$v=19$m=65536,t=3,p=1$FXIa+pXDgzqhMkFjgSX8jw$U/+cr0epasX9h3LCznuMfijjbeEnfoCIbC/1DlACIAY";

export async function login(
  _estadoAnterior: LoginResult | null,
  formData: FormData
): Promise<LoginResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    senha: formData.get("senha"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? MENSAGEM_GENERICA };
  }

  const { email, senha } = parsed.data;
  const ip = await obterIpRequisicao();

  const tokenTurnstile = String(formData.get("cf-turnstile-response") || "");
  const turnstileOk = await verificarTurnstile(tokenTurnstile || null, ip);
  if (!turnstileOk) {
    return { ok: false, mensagem: "Não foi possível confirmar que você não é um robô. Atualize a página e tente de novo." };
  }

  let tentativa;
  try {
    tentativa = await reservarTentativaLogin(email, ip);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: MENSAGEM_BLOQUEIO };
    }
    throw erro;
  }
  if (!tentativa) {
    return { ok: false, mensagem: MENSAGEM_BLOQUEIO };
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });

  const senhaValida = await verifyPassword(
    usuario?.senhaHash ?? HASH_FANTASMA,
    senha
  ).catch(() => false);

  if (!usuario || !senhaValida) {
    return { ok: false, mensagem: MENSAGEM_GENERICA };
  }

  await confirmarTentativaLoginBemSucedida(tentativa.id);
  await criarSessao(usuario.id);

  redirect("/orcamento");
}
