"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";

export type SalvarDadosFiscaisResult = { ok: boolean; mensagem: string };

const CAMPOS_TEXTO = [
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

export async function salvarDadosFiscais(
  _estadoAnterior: SalvarDadosFiscaisResult | null,
  formData: FormData
): Promise<SalvarDadosFiscaisResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const ambiente = formData.get("ambiente");
  if (ambiente !== "homologacao" && ambiente !== "producao") {
    return { ok: false, mensagem: "Ambiente inválido." };
  }

  const dados: Record<string, string | null> = { ambiente };

  for (const campo of CAMPOS_TEXTO) {
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

  await prisma.dadosFiscaisGrafica.upsert({
    where: { graficaId: usuario.graficaId },
    update: dados,
    create: { graficaId: usuario.graficaId, ...dados },
  });

  revalidatePath("/configuracoes/fiscal");
  return { ok: true, mensagem: "Dados fiscais salvos com sucesso!" };
}
