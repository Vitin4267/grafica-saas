"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { RegimeTributario } from "@/generated/prisma/enums";
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

const REGIMES_TRIBUTARIOS: RegimeTributario[] = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"];

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

  const regimeTributarioBruto = formData.get("regimeTributario");
  if (
    typeof regimeTributarioBruto !== "string" ||
    !REGIMES_TRIBUTARIOS.includes(regimeTributarioBruto as RegimeTributario)
  ) {
    return { ok: false, mensagem: "Regime tributário inválido." };
  }
  const regimeTributario = regimeTributarioBruto as RegimeTributario;

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

  await prisma.dadosFiscaisGrafica.upsert({
    where: { graficaId: usuario.graficaId },
    update: { ...dados, regimeTributario, icmsAliquotaPadrao },
    create: { graficaId: usuario.graficaId, ...dados, regimeTributario, icmsAliquotaPadrao },
  });

  revalidatePath("/configuracoes/fiscal");
  return { ok: true, mensagem: "Dados fiscais salvos com sucesso!" };
}
