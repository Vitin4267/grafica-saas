"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";

export type SalvarParametrosResult = { ok: boolean; mensagem: string };

const CAMPOS_DECIMAL = [
  "overheadPercent",
  "margemPadrao",
  "impostoPercent",
  "comissaoPercent",
  "taxaFinanceiraPercent",
  "pedidoMinimo",
  "incrementoArredondamento",
  "margemSegurancaPadrao",
  "gapPecasPadrao",
] as const;

const CAMPOS_INTEIRO = [] as const;

export async function salvarParametros(
  _estadoAnterior: SalvarParametrosResult | null,
  formData: FormData
): Promise<SalvarParametrosResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const dados: Record<string, number> = {};

  for (const campo of CAMPOS_DECIMAL) {
    // Checar presença ANTES de Number(): formData.get devolve null pra campo
    // ausente e "" pra campo em branco, e Number() converte os dois pra 0 —
    // que passava direto por isFinite(0) && 0 >= 0. Um POST forjado omitindo
    // margemPadrao gravava margem 0 silenciosamente, e todo orçamento
    // M2/OFFSET passava a sair a preço de custo sem nenhum aviso.
    const bruto = formData.get(campo);
    if (typeof bruto !== "string" || bruto.trim() === "") {
      return { ok: false, mensagem: `Preencha o campo "${campo}".` };
    }
    const valor = Number(bruto);
    if (!Number.isFinite(valor) || valor < 0) {
      return { ok: false, mensagem: `Valor inválido em "${campo}".` };
    }
    dados[campo] = valor;
  }

  const comissaoVendedorBase = formData.get("comissaoVendedorBase");
  if (comissaoVendedorBase !== "VALOR" && comissaoVendedorBase !== "LUCRO") {
    return { ok: false, mensagem: "Base de cálculo de comissão inválida." };
  }

  for (const campo of CAMPOS_INTEIRO) {
    const valor = Number(formData.get(campo));
    if (!Number.isInteger(valor) || valor < 1) {
      return { ok: false, mensagem: `Valor inválido em "${campo}" — deve ser um número inteiro maior que zero.` };
    }
    dados[campo] = valor;
  }

  if (dados.incrementoArredondamento <= 0) {
    return { ok: false, mensagem: "Incremento de arredondamento deve ser maior que zero." };
  }

  const somaEncargos =
    dados.margemPadrao +
    dados.impostoPercent +
    dados.comissaoPercent +
    dados.taxaFinanceiraPercent;
  if (somaEncargos >= 0.85) {
    return {
      ok: false,
      mensagem:
        "A soma de margem + imposto + comissão + taxa financeira não pode chegar a 85% — isso quebraria o cálculo de todos os orçamentos M2/Offset. Reduza algum desses valores.",
    };
  }

  await prisma.parametrosGrafica.update({
    where: { graficaId: usuario.graficaId },
    data: { ...dados, comissaoVendedorBase },
  });

  revalidatePath("/configuracoes");
  return { ok: true, mensagem: "Parâmetros salvos com sucesso!" };
}
