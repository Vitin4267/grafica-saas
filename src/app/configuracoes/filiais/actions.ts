"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { RegimeTributario } from "@/generated/prisma/enums";
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
  "enderecoCep",
  "enderecoLogradouro",
  "enderecoNumero",
  "enderecoBairro",
  "enderecoMunicipio",
  "enderecoUf",
  "naturezaOperacaoPadrao",
  "cfopPadrao",
  "csosnPadrao",
  "cstIcmsPadrao",
  "icmsModalidadeBaseCalculoPadrao",
  "pisCofinsSituacaoTributariaPadrao",
] as const;

const REGIMES_TRIBUTARIOS_FILIAL: RegimeTributario[] = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"];

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

  const regimeTributarioBruto = formData.get("regimeTributario");
  if (
    typeof regimeTributarioBruto !== "string" ||
    !REGIMES_TRIBUTARIOS_FILIAL.includes(regimeTributarioBruto as RegimeTributario)
  ) {
    return { ok: false, mensagem: "Regime tributário inválido." };
  }
  const regimeTributario = regimeTributarioBruto as RegimeTributario;

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

  // Alíquota é Decimal, não passa pelo loop de texto acima — parse numérico
  // à parte, com a mesma regra de "em branco = null".
  const icmsAliquotaBruta = formData.get("icmsAliquotaPadrao");
  let icmsAliquotaPadrao: number | null = null;
  if (typeof icmsAliquotaBruta === "string" && icmsAliquotaBruta.trim()) {
    const numero = Number(icmsAliquotaBruta);
    if (Number.isNaN(numero) || numero < 0 || numero > 100) {
      return { ok: false, mensagem: "Alíquota de ICMS inválida — use um percentual entre 0 e 100." };
    }
    icmsAliquotaPadrao = numero;
  }

  // Fora do Simples Nacional a nota usa CST-ICMS (não CSOSN) e precisa de
  // alíquota/base/modalidade de cálculo — bloqueia salvar sem os 4 campos
  // em vez de deixar a emissão falhar depois na Focus NFe/SEFAZ.
  if (regimeTributario !== "SIMPLES_NACIONAL") {
    const faltando: string[] = [];
    if (!dados.cstIcmsPadrao) faltando.push("CST-ICMS padrão");
    if (icmsAliquotaPadrao === null) faltando.push("alíquota de ICMS padrão");
    if (!dados.icmsModalidadeBaseCalculoPadrao) faltando.push("modalidade de base de cálculo do ICMS padrão");
    if (!dados.pisCofinsSituacaoTributariaPadrao) faltando.push("situação tributária de PIS/COFINS padrão");
    if (faltando.length > 0) {
      return {
        ok: false,
        mensagem: `Regime tributário fora do Simples Nacional exige a configuração de: ${faltando.join(", ")}.`,
      };
    }
  }

  // Campo de token é write-only: em branco = "manter o valor salvo" (nunca
  // reexibimos o token de verdade no formulário, só os últimos 4 caracteres).
  const novoToken = formData.get("focusNfeToken");
  if (typeof novoToken === "string" && novoToken.trim()) {
    dados.focusNfeToken = novoToken.trim();
  }

  await prisma.dadosFiscaisFilial.upsert({
    where: { filialId },
    update: { ...dados, regimeTributario, icmsAliquotaPadrao },
    create: { filialId, ...dados, regimeTributario, icmsAliquotaPadrao },
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
