"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { criarSessao } from "@/lib/auth/session";
import { verificarBloqueioRegistro, registrarTentativaRegistro } from "@/lib/auth/rate-limit";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { registroSchema } from "@/lib/auth/validation";
import { slugify } from "@/lib/slug";
import { TRIAL_DIAS } from "@/lib/billing/planos";

const MENSAGEM_GENERICA = "Não foi possível concluir o cadastro. Tente novamente.";

export type RegistroResult = {
  ok: boolean;
  mensagem: string;
};

async function gerarSlugUnico(nome: string): Promise<string> {
  const base = slugify(nome) || "grafica";
  let candidato = base;
  let sufixo = 1;

  while (await prisma.grafica.findUnique({ where: { slug: candidato } })) {
    sufixo += 1;
    candidato = `${base}-${sufixo}`;
  }

  return candidato;
}

export async function registrar(
  _estadoAnterior: RegistroResult | null,
  formData: FormData
): Promise<RegistroResult> {
  // Honeypot: campo escondido via CSS que só um preenchedor automático de
  // formulário (bot) preenche — uma pessoa de verdade nunca vê nem toca nele.
  // Rejeitado com a mesma mensagem genérica de erro, pra não entregar ao bot
  // qual campo é a armadilha.
  if (String(formData.get("site") || "").trim()) {
    return { ok: false, mensagem: MENSAGEM_GENERICA };
  }

  const ip = await obterIpRequisicao();
  const bloqueado = await verificarBloqueioRegistro(ip);
  if (bloqueado) {
    return {
      ok: false,
      mensagem: "Muitas tentativas de cadastro. Aguarde um pouco e tente novamente.",
    };
  }
  await registrarTentativaRegistro(ip);

  if (formData.get("aceiteTermos") !== "on") {
    return {
      ok: false,
      mensagem: "É preciso concordar com os Termos de Uso e a Política de Privacidade.",
    };
  }

  const parsed = registroSchema.safeParse({
    graficaNome: formData.get("graficaNome"),
    nome: formData.get("nome"),
    email: formData.get("email"),
    senha: formData.get("senha"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { graficaNome, nome, email, senha } = parsed.data;

  const emailExistente = await prisma.usuario.findUnique({ where: { email } });
  if (emailExistente) {
    return { ok: false, mensagem: "Este e-mail já está cadastrado." };
  }

  const slug = await gerarSlugUnico(graficaNome);
  const senhaHash = await hashPassword(senha);

  const trialExpiraEm = new Date();
  trialExpiraEm.setUTCDate(trialExpiraEm.getUTCDate() + TRIAL_DIAS);

  const usuario = await prisma.$transaction(async (tx) => {
    const grafica = await tx.grafica.create({
      data: { nome: graficaNome, slug },
    });

    // O relógio do trial começa no cadastro, não na primeira vez que o DONO
    // abre /configuracoes/assinatura — senão alguém que nunca visita essa
    // tela ficaria com trial "infinito" por omissão.
    await tx.assinaturaGrafica.create({
      data: { graficaId: grafica.id, status: "TRIALING", trialExpiraEm },
    });

    return tx.usuario.create({
      data: {
        graficaId: grafica.id,
        nome,
        email,
        senhaHash,
        papel: "DONO",
      },
    });
  });

  await criarSessao(usuario.id);

  redirect("/bem-vindo");
}
