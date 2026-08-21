"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";

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

// Muda qualquer um destes muda TODO preço futuro da gráfica (ver missão) —
// por isso o log registra antes/depois de CADA campo alterado, não só "os
// parâmetros foram salvos".
const ROTULO_CAMPO_PARAMETRO: Record<(typeof CAMPOS_DECIMAL)[number], string> = {
  overheadPercent: "Overhead",
  margemPadrao: "Margem",
  impostoPercent: "Imposto",
  comissaoPercent: "Comissão (markup de preço)",
  taxaFinanceiraPercent: "Taxa financeira",
  pedidoMinimo: "Pedido mínimo",
  incrementoArredondamento: "Incremento de arredondamento",
  margemSegurancaPadrao: "Margem de segurança (nesting)",
  gapPecasPadrao: "Gap entre peças (nesting)",
};
const CAMPOS_PERCENTUAL_PARAMETRO = new Set<(typeof CAMPOS_DECIMAL)[number]>([
  "overheadPercent",
  "margemPadrao",
  "impostoPercent",
  "comissaoPercent",
  "taxaFinanceiraPercent",
  "margemSegurancaPadrao",
  "gapPecasPadrao",
]);
const formatoPercentualParametro = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});
function formatarCampoParametro(campo: (typeof CAMPOS_DECIMAL)[number], valor: number): string {
  return CAMPOS_PERCENTUAL_PARAMETRO.has(campo)
    ? formatoPercentualParametro.format(valor)
    : formatoMoeda.format(valor);
}
const ROTULO_BASE_COMISSAO: Record<"VALOR" | "LUCRO", string> = {
  VALOR: "Valor do orçamento",
  LUCRO: "Lucro (total − custo)",
};
const ROTULO_UNIDADE_DIMENSAO: Record<"MM" | "CM" | "M", string> = {
  MM: "Milímetro",
  CM: "Centímetro",
  M: "Metro",
};

// Os 3 limiares (dias antes do prazo) do alerta de prazo por e-mail — ver
// src/lib/alerta-prazo-email.ts. Fora de CAMPOS_DECIMAL/CAMPOS_INTEIRO
// (que exigem > 0) porque o terceiro limiar é 0 por padrão (dia do prazo).
const CAMPOS_LIMIAR_PRAZO = [
  "alertaPrazoLimiar1Dias",
  "alertaPrazoLimiar2Dias",
  "alertaPrazoLimiar3Dias",
] as const;
const ROTULO_LIMIAR_PRAZO: Record<(typeof CAMPOS_LIMIAR_PRAZO)[number], string> = {
  alertaPrazoLimiar1Dias: "1º aviso (dias antes do prazo)",
  alertaPrazoLimiar2Dias: "2º aviso (dias antes do prazo)",
  alertaPrazoLimiar3Dias: "3º aviso (dias antes do prazo)",
};

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

  // Unidade de entrada/exibição de medida (ver src/lib/unidade-dimensao.ts)
  // — mora em Grafica, não em ParametrosGrafica, porque não é um parâmetro
  // do motor de precificação. Nunca reconverte/altera orçamentos já salvos:
  // OrcamentoItem.larguraCm/alturaCm continuam sempre em centímetros.
  const unidadePadraoDimensao = formData.get("unidadePadraoDimensao");
  if (
    unidadePadraoDimensao !== "MM" &&
    unidadePadraoDimensao !== "CM" &&
    unidadePadraoDimensao !== "M"
  ) {
    return { ok: false, mensagem: "Unidade padrão de dimensão inválida." };
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

  // Mesmo cuidado do loop de CAMPOS_DECIMAL acima: checar presença antes de
  // Number(), senão campo ausente/"" vira 0 e passaria como "válido" numa
  // checagem que só testasse isFinite.
  const diasValidadeOrcamentoPadraoBruto = formData.get("diasValidadeOrcamentoPadrao");
  if (typeof diasValidadeOrcamentoPadraoBruto !== "string" || diasValidadeOrcamentoPadraoBruto.trim() === "") {
    return { ok: false, mensagem: "Preencha o campo \"Dias de validade do orçamento\"." };
  }
  const diasValidadeOrcamentoPadrao = Number(diasValidadeOrcamentoPadraoBruto);
  if (!Number.isInteger(diasValidadeOrcamentoPadrao) || diasValidadeOrcamentoPadrao <= 0) {
    return {
      ok: false,
      mensagem: "Dias de validade do orçamento precisa ser um número inteiro maior que zero.",
    };
  }

  // Mesmo cuidado do bloco de diasValidadeOrcamentoPadrao acima: checar
  // presença antes de Number(). Alimenta a lista de "orçamentos parados"
  // (ver /orcamento/parados/page.tsx e orcamentoEstaParado em
  // src/lib/orcamento-status.ts) — quantos dias um ENVIADO fica sem resposta
  // até aparecer lá pro vendedor cobrar.
  const diasAlertaOrcamentoParadoBruto = formData.get("diasAlertaOrcamentoParado");
  if (typeof diasAlertaOrcamentoParadoBruto !== "string" || diasAlertaOrcamentoParadoBruto.trim() === "") {
    return { ok: false, mensagem: 'Preencha o campo "Dias para orçamento parado".' };
  }
  const diasAlertaOrcamentoParado = Number(diasAlertaOrcamentoParadoBruto);
  if (!Number.isInteger(diasAlertaOrcamentoParado) || diasAlertaOrcamentoParado <= 0) {
    return {
      ok: false,
      mensagem: 'Dias para orçamento parado precisa ser um número inteiro maior que zero.',
    };
  }

  // Alerta de prazo por e-mail (ver src/lib/alerta-prazo-email.ts): liga/
  // desliga geral + os 3 limiares, em dias antes do prazo. 0 é um valor
  // válido (dia do prazo/atrasado), por isso valida >= 0 em vez de > 0 como
  // os CAMPOS_INTEIRO acima.
  const limiaresPrazo: Record<string, number> = {};
  for (const campo of CAMPOS_LIMIAR_PRAZO) {
    const bruto = formData.get(campo);
    if (typeof bruto !== "string" || bruto.trim() === "") {
      return { ok: false, mensagem: `Preencha o campo "${ROTULO_LIMIAR_PRAZO[campo]}".` };
    }
    const valor = Number(bruto);
    if (!Number.isInteger(valor) || valor < 0) {
      return {
        ok: false,
        mensagem: `Valor inválido em "${ROTULO_LIMIAR_PRAZO[campo]}" — deve ser um número inteiro não-negativo.`,
      };
    }
    limiaresPrazo[campo] = valor;
  }
  if (
    !(
      limiaresPrazo.alertaPrazoLimiar1Dias > limiaresPrazo.alertaPrazoLimiar2Dias &&
      limiaresPrazo.alertaPrazoLimiar2Dias > limiaresPrazo.alertaPrazoLimiar3Dias
    )
  ) {
    return {
      ok: false,
      mensagem:
        "Os 3 avisos do alerta de prazo precisam estar em ordem decrescente (ex: 5, 3, 0) — o 1º aviso tem que ser mais folgado que o 2º, e o 2º mais que o 3º.",
    };
  }
  const alertaPrazoAtivo = formData.get("alertaPrazoAtivo") === "on";

  // Opcional, ao contrário dos CAMPOS_DECIMAL acima — não faz parte da
  // composição de preço (só exibição no card de tinta), então em branco é um
  // estado válido (limpa a estimativa de valor), não erro.
  let custoTintaPorMl: number | null = null;
  const custoTintaPorMlBruto = formData.get("custoTintaPorMl");
  if (typeof custoTintaPorMlBruto === "string" && custoTintaPorMlBruto.trim() !== "") {
    const valor = Number(custoTintaPorMlBruto);
    if (!Number.isFinite(valor) || valor < 0 || valor > 1000) {
      return { ok: false, mensagem: 'Valor inválido em "Custo do ml de tinta" — deve ser entre 0 e R$ 1.000,00.' };
    }
    custoTintaPorMl = valor;
  }

  // Bloco de termos e condições do PDF de orçamento (ver
  // src/lib/pdf/OrcamentoDocumento.tsx). Igual custoTintaPorMl acima, em
  // branco é um estado válido — mas aqui significa "voltar a usar o texto
  // padrão do sistema" (TERMOS_CONDICOES_PDF_PADRAO), nunca "PDF sem
  // cláusula nenhuma" (exposição jurídica se um pedido for contestado).
  let termosCondicoesPdf: string | null = null;
  const termosCondicoesPdfBruto = formData.get("termosCondicoesPdf");
  if (typeof termosCondicoesPdfBruto === "string" && termosCondicoesPdfBruto.trim() !== "") {
    if (termosCondicoesPdfBruto.length > 4000) {
      return {
        ok: false,
        mensagem: 'Termos e condições do PDF muito longos — máximo de 4.000 caracteres.',
      };
    }
    termosCondicoesPdf = termosCondicoesPdfBruto.trim();
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

  const [parametrosAntes, graficaAntes] = await Promise.all([
    prisma.parametrosGrafica.findUnique({ where: { graficaId: usuario.graficaId } }),
    prisma.grafica.findUnique({
      where: { id: usuario.graficaId },
      select: { unidadePadraoDimensao: true },
    }),
  ]);

  await prisma.parametrosGrafica.update({
    where: { graficaId: usuario.graficaId },
    data: {
      ...dados,
      comissaoVendedorBase,
      custoTintaPorMl,
      termosCondicoesPdf,
      diasValidadeOrcamentoPadrao,
      diasAlertaOrcamentoParado,
      alertaPrazoAtivo,
      alertaPrazoLimiar1Dias: limiaresPrazo.alertaPrazoLimiar1Dias,
      alertaPrazoLimiar2Dias: limiaresPrazo.alertaPrazoLimiar2Dias,
      alertaPrazoLimiar3Dias: limiaresPrazo.alertaPrazoLimiar3Dias,
    },
  });

  await prisma.grafica.update({
    where: { id: usuario.graficaId },
    data: { unidadePadraoDimensao },
  });

  const antesTextos: string[] = [];
  const depoisTextos: string[] = [];

  for (const campo of CAMPOS_DECIMAL) {
    const antes = parametrosAntes ? Number(parametrosAntes[campo]) : null;
    const depois = dados[campo];
    if (antes === null || antes !== depois) {
      antesTextos.push(`${ROTULO_CAMPO_PARAMETRO[campo]}: ${antes === null ? "—" : formatarCampoParametro(campo, antes)}`);
      depoisTextos.push(`${ROTULO_CAMPO_PARAMETRO[campo]}: ${formatarCampoParametro(campo, depois)}`);
    }
  }

  if ((parametrosAntes?.comissaoVendedorBase ?? "VALOR") !== comissaoVendedorBase) {
    antesTextos.push(`Base de comissão: ${ROTULO_BASE_COMISSAO[parametrosAntes?.comissaoVendedorBase ?? "VALOR"]}`);
    depoisTextos.push(`Base de comissão: ${ROTULO_BASE_COMISSAO[comissaoVendedorBase]}`);
  }

  const custoTintaAntes = parametrosAntes?.custoTintaPorMl != null ? Number(parametrosAntes.custoTintaPorMl) : null;
  if (custoTintaAntes !== custoTintaPorMl) {
    antesTextos.push(`Custo do ml de tinta: ${custoTintaAntes === null ? "—" : formatoMoeda.format(custoTintaAntes)}`);
    depoisTextos.push(`Custo do ml de tinta: ${custoTintaPorMl === null ? "—" : formatoMoeda.format(custoTintaPorMl)}`);
  }

  // Log só se mudou de "padrão do sistema" pra "personalizado" (ou vice-
  // versa) — nunca o texto completo em si, pra não inflar o log de
  // auditoria com blocos de texto jurídico a cada edição pontual.
  const termosCondicoesPdfAntes = parametrosAntes?.termosCondicoesPdf ?? null;
  if (termosCondicoesPdfAntes !== termosCondicoesPdf) {
    antesTextos.push(`Termos e condições do PDF: ${termosCondicoesPdfAntes ? "personalizado" : "padrão do sistema"}`);
    depoisTextos.push(`Termos e condições do PDF: ${termosCondicoesPdf ? "personalizado" : "padrão do sistema"}`);
  }

  const diasValidadeOrcamentoPadraoAntes = parametrosAntes?.diasValidadeOrcamentoPadrao ?? 15;
  if (diasValidadeOrcamentoPadraoAntes !== diasValidadeOrcamentoPadrao) {
    antesTextos.push(`Dias de validade do orçamento: ${diasValidadeOrcamentoPadraoAntes}`);
    depoisTextos.push(`Dias de validade do orçamento: ${diasValidadeOrcamentoPadrao}`);
  }

  const diasAlertaOrcamentoParadoAntes = parametrosAntes?.diasAlertaOrcamentoParado ?? 5;
  if (diasAlertaOrcamentoParadoAntes !== diasAlertaOrcamentoParado) {
    antesTextos.push(`Dias para orçamento parado: ${diasAlertaOrcamentoParadoAntes}`);
    depoisTextos.push(`Dias para orçamento parado: ${diasAlertaOrcamentoParado}`);
  }

  if ((graficaAntes?.unidadePadraoDimensao ?? "CM") !== unidadePadraoDimensao) {
    antesTextos.push(`Unidade padrão: ${ROTULO_UNIDADE_DIMENSAO[graficaAntes?.unidadePadraoDimensao ?? "CM"]}`);
    depoisTextos.push(`Unidade padrão: ${ROTULO_UNIDADE_DIMENSAO[unidadePadraoDimensao]}`);
  }

  if ((parametrosAntes?.alertaPrazoAtivo ?? true) !== alertaPrazoAtivo) {
    antesTextos.push(`Alerta de prazo ativo: ${(parametrosAntes?.alertaPrazoAtivo ?? true) ? "sim" : "não"}`);
    depoisTextos.push(`Alerta de prazo ativo: ${alertaPrazoAtivo ? "sim" : "não"}`);
  }
  for (const campo of CAMPOS_LIMIAR_PRAZO) {
    const antes = parametrosAntes?.[campo] ?? (campo === "alertaPrazoLimiar1Dias" ? 5 : campo === "alertaPrazoLimiar2Dias" ? 3 : 0);
    const depois = limiaresPrazo[campo];
    if (antes !== depois) {
      antesTextos.push(`${ROTULO_LIMIAR_PRAZO[campo]}: ${antes}`);
      depoisTextos.push(`${ROTULO_LIMIAR_PRAZO[campo]}: ${depois}`);
    }
  }

  if (antesTextos.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_parametros",
      entidade: "ParametrosGrafica",
      entidadeId: usuario.graficaId,
      descricao: "Parâmetros de precificação atualizados",
      valorAnterior: antesTextos.join("; "),
      valorNovo: depoisTextos.join("; "),
    });
  }

  revalidatePath("/configuracoes");
  return { ok: true, mensagem: "Parâmetros salvos com sucesso!" };
}
