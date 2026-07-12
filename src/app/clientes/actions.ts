"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { clienteSchema } from "@/lib/clientes";

export type CriarClienteResult = { ok: boolean; mensagem: string };

export async function criarCliente(
  _estadoAnterior: CriarClienteResult | null,
  formData: FormData
): Promise<CriarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }

  const parsed = clienteSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    documento: formData.get("documento"),
    enderecoCep: formData.get("enderecoCep"),
    enderecoLogradouro: formData.get("enderecoLogradouro"),
    enderecoNumero: formData.get("enderecoNumero"),
    enderecoComplemento: formData.get("enderecoComplemento"),
    enderecoBairro: formData.get("enderecoBairro"),
    enderecoMunicipio: formData.get("enderecoMunicipio"),
    enderecoCodigoIbge: formData.get("enderecoCodigoIbge"),
    enderecoUf: formData.get("enderecoUf"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const {
    nome,
    email,
    telefone,
    documento,
    enderecoCep,
    enderecoLogradouro,
    enderecoNumero,
    enderecoComplemento,
    enderecoBairro,
    enderecoMunicipio,
    enderecoCodigoIbge,
    enderecoUf,
  } = parsed.data;

  await prisma.cliente.create({
    data: {
      graficaId: usuario.graficaId,
      nome,
      email: email || null,
      telefone: telefone || null,
      documento: documento || null,
      enderecoCep: enderecoCep || null,
      enderecoLogradouro: enderecoLogradouro || null,
      enderecoNumero: enderecoNumero || null,
      enderecoComplemento: enderecoComplemento || null,
      enderecoBairro: enderecoBairro || null,
      enderecoMunicipio: enderecoMunicipio || null,
      enderecoCodigoIbge: enderecoCodigoIbge || null,
      enderecoUf: enderecoUf || null,
    },
  });

  revalidatePath("/clientes");
  revalidatePath("/orcamento");
  revalidatePath("/comecar");

  return { ok: true, mensagem: `Cliente "${nome}" cadastrado com sucesso!` };
}

export type AtualizarClienteResult = { ok: boolean; mensagem: string };

export async function atualizarCliente(
  _estadoAnterior: AtualizarClienteResult | null,
  formData: FormData
): Promise<AtualizarClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  const parsed = clienteSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    documento: formData.get("documento"),
    enderecoCep: formData.get("enderecoCep"),
    enderecoLogradouro: formData.get("enderecoLogradouro"),
    enderecoNumero: formData.get("enderecoNumero"),
    enderecoComplemento: formData.get("enderecoComplemento"),
    enderecoBairro: formData.get("enderecoBairro"),
    enderecoMunicipio: formData.get("enderecoMunicipio"),
    enderecoCodigoIbge: formData.get("enderecoCodigoIbge"),
    enderecoUf: formData.get("enderecoUf"),
  });

  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const {
    nome,
    email,
    telefone,
    documento,
    enderecoCep,
    enderecoLogradouro,
    enderecoNumero,
    enderecoComplemento,
    enderecoBairro,
    enderecoMunicipio,
    enderecoCodigoIbge,
    enderecoUf,
  } = parsed.data;

  await prisma.cliente.update({
    where: { id: clienteId },
    data: {
      nome,
      email: email || null,
      telefone: telefone || null,
      documento: documento || null,
      enderecoCep: enderecoCep || null,
      enderecoLogradouro: enderecoLogradouro || null,
      enderecoNumero: enderecoNumero || null,
      enderecoComplemento: enderecoComplemento || null,
      enderecoBairro: enderecoBairro || null,
      enderecoMunicipio: enderecoMunicipio || null,
      enderecoCodigoIbge: enderecoCodigoIbge || null,
      enderecoUf: enderecoUf || null,
    },
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${clienteId}`);
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Cliente atualizado com sucesso!" };
}

export type ExcluirClienteResult = { ok: boolean; mensagem: string };

export async function excluirCliente(
  _estadoAnterior: ExcluirClienteResult | null,
  formData: FormData
): Promise<ExcluirClienteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CLIENTES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar clientes." };
  }
  const clienteId = String(formData.get("clienteId"));

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  try {
    await prisma.cliente.delete({ where: { id: clienteId } });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2003") {
      return {
        ok: false,
        mensagem:
          "Este cliente tem orçamentos vinculados e não pode ser excluído. Se quiser mesmo assim remover os dados pessoais dele, fale com o suporte.",
      };
    }
    throw erro;
  }

  revalidatePath("/clientes");
  redirect("/clientes");
}
