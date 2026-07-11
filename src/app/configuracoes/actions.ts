"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
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
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const dados: Record<string, number> = {};

  for (const campo of CAMPOS_DECIMAL) {
    const valor = Number(formData.get(campo));
    if (!Number.isFinite(valor) || valor < 0) {
      return { ok: false, mensagem: `Valor inválido em "${campo}".` };
    }
    dados[campo] = valor;
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
    data: dados,
  });

  revalidatePath("/configuracoes");
  return { ok: true, mensagem: "Parâmetros salvos com sucesso!" };
}
