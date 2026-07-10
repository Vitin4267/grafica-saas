"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirPapel } from "@/lib/auth/permissoes";
import { senhaSchema } from "@/lib/auth/validation";
import { hashPassword } from "@/lib/auth/password";

export type CriarUsuarioResult = { ok: boolean; mensagem: string };

const criarUsuarioSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  senha: senhaSchema,
  papel: z.enum(["ADMIN", "OPERADOR"]),
});

export async function criarUsuario(
  _estadoAnterior: CriarUsuarioResult | null,
  formData: FormData
): Promise<CriarUsuarioResult> {
  const usuario = await exigirUsuarioAutenticado();
  exigirPapel(usuario, ["DONO"]);

  const parsed = criarUsuarioSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    senha: formData.get("senha"),
    papel: formData.get("papel"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { nome, email, senha, papel } = parsed.data;

  // Usuario.email é único globalmente no schema (não só por gráfica).
  const emailExistente = await prisma.usuario.findUnique({ where: { email } });
  if (emailExistente) {
    return { ok: false, mensagem: "Este e-mail já está cadastrado em alguma gráfica." };
  }

  const senhaHash = await hashPassword(senha);

  await prisma.usuario.create({
    data: {
      graficaId: usuario.graficaId,
      nome,
      email,
      senhaHash,
      papel,
    },
  });

  revalidatePath("/usuarios");
  return { ok: true, mensagem: `Usuário "${nome}" criado com sucesso!` };
}

export type SalvarAcessoMeuNegocioResult = { ok: boolean; mensagem: string };

// Dois níveis salvos juntos: o switch geral da gráfica (Grafica.compartilharMeuNegocio)
// e a concessão individual por funcionário (Usuario.acessoMeuNegocio) — ver
// podeVerMeuNegocio em lib/auth/permissoes.ts para a regra de combinação dos dois.
// Igual a salvarCatalogo: checkbox ausente no FormData = desmarcado.
export async function salvarAcessoMeuNegocio(
  _estadoAnterior: SalvarAcessoMeuNegocioResult | null,
  formData: FormData
): Promise<SalvarAcessoMeuNegocioResult> {
  const usuario = await exigirUsuarioAutenticado();
  exigirPapel(usuario, ["DONO"]);

  const compartilhar = formData.get("compartilhar") === "on";

  const funcionarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId, papel: { not: "DONO" } },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.grafica.update({
      where: { id: usuario.graficaId },
      data: { compartilharMeuNegocio: compartilhar },
    }),
    ...funcionarios.map((f) =>
      prisma.usuario.update({
        where: { id: f.id },
        data: { acessoMeuNegocio: formData.get(`acesso_${f.id}`) === "on" },
      })
    ),
  ]);

  revalidatePath("/usuarios");
  revalidatePath("/meu-negocio");

  return { ok: true, mensagem: "Acesso atualizado com sucesso!" };
}
