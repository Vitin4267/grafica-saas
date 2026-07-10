"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { criarSessao } from "@/lib/auth/session";
import { registroSchema } from "@/lib/auth/validation";
import { slugify } from "@/lib/slug";

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

  const usuario = await prisma.$transaction(async (tx) => {
    const grafica = await tx.grafica.create({
      data: { nome: graficaNome, slug },
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

  redirect("/comecar");
}
