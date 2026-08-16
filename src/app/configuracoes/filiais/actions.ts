"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";

export type SalvarFilialResult = { ok: boolean; mensagem: string };

export async function criarFilial(
  _estadoAnterior: SalvarFilialResult | null,
  formData: FormData
): Promise<SalvarFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a filial." };
  }

  let novaFilial: { id: string };
  try {
    novaFilial = await prisma.filial.create({
      data: { graficaId: usuario.graficaId, nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma filial com esse nome." };
    }
    throw erro;
  }

  revalidatePath("/configuracoes/filiais");
  redirect(`/configuracoes/filiais/${novaFilial.id}`);
}

export async function salvarFilial(
  _estadoAnterior: SalvarFilialResult | null,
  formData: FormData
): Promise<SalvarFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const filialId = String(formData.get("filialId"));

  const filial = await prisma.filial.findFirst({
    where: { id: filialId, graficaId: usuario.graficaId },
  });
  if (!filial) {
    return { ok: false, mensagem: "Filial não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a filial." };
  }
  const enderecoBruto = String(formData.get("endereco") ?? "").trim();
  const endereco = enderecoBruto || null;
  const ativa = formData.get("ativa") === "on";

  try {
    await prisma.filial.update({
      where: { id: filialId },
      data: { nome, endereco, ativa },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma filial com esse nome." };
    }
    throw erro;
  }

  revalidatePath(`/configuracoes/filiais/${filialId}`);
  revalidatePath("/configuracoes/filiais");
  return { ok: true, mensagem: "Filial salva com sucesso!" };
}

export type SalvarDadosFiscaisFilialResult = { ok: boolean; mensagem: string };

// Mesmos campos de src/app/configuracoes/fiscal/actions.ts (salvarDadosFiscais)
// — DadosFiscaisFilial espelha DadosFiscaisGrafica campo a campo.
const CAMPOS_TEXTO_FISCAL = [
  "cnpj",
  "razaoSocial",
  "nomeFantasia",
  "inscricaoEstadual",
  "regimeTributario",
  "enderecoCep",
  "enderecoLogradouro",
  "enderecoNumero",
  "enderecoBairro",
  "enderecoMunicipio",
  "enderecoUf",
  "naturezaOperacaoPadrao",
  "cfopPadrao",
  "csosnPadrao",
] as const;

// Opcional por natureza: só existe linha em DadosFiscaisFilial quando a
// filial de fato tem CNPJ próprio configurado (ver resolverDadosFiscais em
// src/lib/nota-fiscal.ts) — sem isso, a emissão de nota continua usando os
// dados fiscais da gráfica, comportamento de sempre.
export async function salvarDadosFiscaisFilial(
  _estadoAnterior: SalvarDadosFiscaisFilialResult | null,
  formData: FormData
): Promise<SalvarDadosFiscaisFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const filialId = String(formData.get("filialId"));

  // Isolamento de tenant: a filial precisa ser da própria gráfica do usuário
  // logado antes de mexer no cadastro fiscal dela.
  const filial = await prisma.filial.findFirst({
    where: { id: filialId, graficaId: usuario.graficaId },
  });
  if (!filial) {
    return { ok: false, mensagem: "Filial não encontrada." };
  }

  const ambiente = formData.get("ambiente");
  if (ambiente !== "homologacao" && ambiente !== "producao") {
    return { ok: false, mensagem: "Ambiente inválido." };
  }

  const dados: Record<string, string | null> = { ambiente };

  for (const campo of CAMPOS_TEXTO_FISCAL) {
    const valor = formData.get(campo);
    dados[campo] = typeof valor === "string" && valor.trim() ? valor.trim() : null;
  }

  // CEP alimenta a emissão de nota fiscal de verdade (Focus NFe) — falhar
  // aqui, com mensagem clara, é melhor que só descobrir na hora de emitir.
  if (dados.enderecoCep && !/^\d{5}-?\d{3}$/.test(dados.enderecoCep)) {
    return { ok: false, mensagem: "CEP inválido — use o formato 00000-000." };
  }

  // Campo de token é write-only: em branco = "manter o valor salvo" (nunca
  // reexibimos o token de verdade no formulário, só os últimos 4 caracteres).
  const novoToken = formData.get("focusNfeToken");
  if (typeof novoToken === "string" && novoToken.trim()) {
    dados.focusNfeToken = novoToken.trim();
  }

  await prisma.dadosFiscaisFilial.upsert({
    where: { filialId },
    update: dados,
    create: { filialId, ...dados },
  });

  revalidatePath(`/configuracoes/filiais/${filialId}`);
  return { ok: true, mensagem: "Dados fiscais da filial salvos com sucesso!" };
}

// Sempre permitida (ao contrário de excluirPrensa) — Orcamento.filialId é
// onDelete: SetNull, então excluir uma filial só desvincula os orçamentos
// antigos dela (viram "sem filial"), nunca bloqueia por causa de histórico.
// Fechar uma filial não deveria travar limpeza de cadastro.
export async function excluirFilial(
  _estadoAnterior: SalvarFilialResult | null,
  formData: FormData
): Promise<SalvarFilialResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const filialId = String(formData.get("filialId"));

  const filial = await prisma.filial.findFirst({
    where: { id: filialId, graficaId: usuario.graficaId },
  });
  if (!filial) {
    return { ok: false, mensagem: "Filial não encontrada." };
  }

  await prisma.filial.delete({ where: { id: filialId } });

  revalidatePath("/configuracoes/filiais");
  redirect("/configuracoes/filiais");
}
