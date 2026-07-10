"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { clienteSchema } from "@/lib/clientes";

export type CriarClienteResult = { ok: boolean; mensagem: string };

export async function criarCliente(
  _estadoAnterior: CriarClienteResult | null,
  formData: FormData
): Promise<CriarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();

  const parsed = clienteSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    documento: formData.get("documento"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { nome, email, telefone, documento } = parsed.data;

  await prisma.cliente.create({
    data: {
      graficaId: usuario.graficaId,
      nome,
      email: email || null,
      telefone: telefone || null,
      documento: documento || null,
    },
  });

  revalidatePath("/clientes");
  revalidatePath("/orcamento");
  revalidatePath("/comecar");

  return { ok: true, mensagem: `Cliente "${nome}" cadastrado com sucesso!` };
}
