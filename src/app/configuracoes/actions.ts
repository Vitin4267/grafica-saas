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

// Convenção do bitmask de ParametrosGrafica.diasFuncionamento (ver comentário
// no schema): bit0=segunda...bit6=domingo — achado A2 da Parte 6 da
// auditoria de abrangência (2026-08-27).
const ROTULO_DIA_BIT: Record<number, string> = {
  0: "Seg",
  1: "Ter",
  2: "Qua",
  3: "Qui",
  4: "Sex",
  5: "Sáb",
  6: "Dom",
};
function formatarDiasFuncionamento(bitmask: number): string {
  const dias = [0, 1, 2, 3, 4, 5, 6]
    .filter((bit) => (bitmask & (1 << bit)) !== 0)
    .map((bit) => ROTULO_DIA_BIT[bit]);
  return dias.length > 0 ? dias.join(", ") : "nenhum";
}

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

// 8 campos da fase "custo real" (schema.prisma, ParametrosGrafica ~L130-139)
// — existiam no schema sem nenhum caminho de escrita no form (achado A1 da
// auditoria de abrangência, 2026-08-24). Os 3 abaixo são percentuais
// "inteiros" (10 = 10%), diferente de CAMPOS_DECIMAL acima (0.15 = 15%) —
// por isso ficam de fora daquele array, com validação/formatação própria.
const CAMPOS_PERCENTUAL_INTEIRO = [
  "margemFaixaBaixa",
  "margemFaixaBoa",
  "descontoMaxSemAprovacao",
  "toleranciaTiragemPadraoPercent",
  "toleranciaTiragemPercent",
] as const;
const ROTULO_PERCENTUAL_INTEIRO: Record<(typeof CAMPOS_PERCENTUAL_INTEIRO)[number], string> = {
  margemFaixaBaixa: "Margem faixa baixa",
  margemFaixaBoa: "Margem faixa boa",
  descontoMaxSemAprovacao: "Desconto máximo sem aprovação",
  toleranciaTiragemPadraoPercent: "Tolerância de tiragem (padrão)",
  toleranciaTiragemPercent: "Tolerância de tiragem",
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

  // Tudo ou nada de propósito (ver comentário do campo no schema) — usuário
  // pediu explicitamente a versão simples em vez de um toggle por campo de
  // etiqueta (2026-08-23).
  const mostrarEspecificacoesTecnicas = formData.get("mostrarEspecificacoesTecnicas") === "on";

  // Fase "custo real" (ver comentário de CAMPOS_PERCENTUAL_INTEIRO acima) —
  // 3 booleans simples, seguindo o mesmo padrão de alertaPrazoAtivo/
  // mostrarEspecificacoesTecnicas.
  const custoAutomaticoConsumo = formData.get("custoAutomaticoConsumo") === "on";
  const perdaEhCustoDoPedido = formData.get("perdaEhCustoDoPedido") === "on";
  const comissaoEntraNoCustoPedido = formData.get("comissaoEntraNoCustoPedido") === "on";

  // Achado A6 da Parte 4 da auditoria de abrangência (2026-08-27) — mesmo
  // padrão dos 3 booleans acima. Ver comentário no schema.prisma
  // (ParametrosGrafica.bloqueiaAoUltrapassarLimiteCredito) pra distinção
  // com o bloqueio manual de Cliente, que nunca vira trava de verdade.
  const bloqueiaAoUltrapassarLimiteCredito = formData.get("bloqueiaAoUltrapassarLimiteCredito") === "on";

  // categoriaCustoConsumoPadraoId — FK opcional pra CategoriaCusto ("nenhuma"
  // = cai no fallback "primeira categoria ativa por ordem", ver
  // criarCustoAutomaticoConsumo em src/app/producao/status-transicao.ts).
  // Validado contra o tenant antes de gravar — nunca aceita um id de
  // categoria de outra gráfica (POST forjado).
  const categoriaCustoConsumoPadraoIdBruto = formData.get("categoriaCustoConsumoPadraoId");
  const categoriaCustoConsumoPadraoId: string | null =
    typeof categoriaCustoConsumoPadraoIdBruto === "string" &&
    categoriaCustoConsumoPadraoIdBruto.trim() !== ""
      ? categoriaCustoConsumoPadraoIdBruto.trim()
      : null;
  if (categoriaCustoConsumoPadraoId) {
    const categoriaValida = await prisma.categoriaCusto.findFirst({
      where: { id: categoriaCustoConsumoPadraoId, graficaId: usuario.graficaId },
      select: { id: true },
    });
    if (!categoriaValida) {
      return { ok: false, mensagem: "Categoria de custo padrão selecionada é inválida." };
    }
  }

  // Mesmo cuidado de presença dos blocos acima (campo ausente/"" não pode
  // virar 0 silenciosamente).
  const percentuaisInteiros: Record<string, number> = {};
  for (const campo of CAMPOS_PERCENTUAL_INTEIRO) {
    const bruto = formData.get(campo);
    if (typeof bruto !== "string" || bruto.trim() === "") {
      return { ok: false, mensagem: `Preencha o campo "${ROTULO_PERCENTUAL_INTEIRO[campo]}".` };
    }
    const valor = Number(bruto);
    if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
      return {
        ok: false,
        mensagem: `Valor inválido em "${ROTULO_PERCENTUAL_INTEIRO[campo]}" — deve ser entre 0 e 100.`,
      };
    }
    percentuaisInteiros[campo] = valor;
  }
  if (percentuaisInteiros.margemFaixaBaixa >= percentuaisInteiros.margemFaixaBoa) {
    return {
      ok: false,
      mensagem: 'A "Margem faixa baixa" precisa ser menor que a "Margem faixa boa".',
    };
  }

  // Achado A2 da Parte 6 (auditoria de abrangência, 2026-08-27) — como a
  // gráfica cota o prazo de entrega (dias úteis vs corridos) + em quais dias
  // da semana ela funciona (bitmask, ver ParametrosGrafica.diasFuncionamento
  // no schema). Vem como checkbox único + N checkboxes de dia-da-semana
  // (ParametrosForm.tsx converte pro bitmask aqui, não no form).
  const prazoEmDiasUteis = formData.get("prazoEmDiasUteis") === "on";
  const diasFuncionamento = formData
    .getAll("diaFuncionamento")
    .map(Number)
    .reduce((acc, bit) => (Number.isInteger(bit) && bit >= 0 && bit <= 6 ? acc | (1 << bit) : acc), 0);
  if (diasFuncionamento === 0) {
    return { ok: false, mensagem: "Selecione ao menos um dia de funcionamento." };
  }

  const diasPrecoInsumoDesatualizadoBruto = formData.get("diasPrecoInsumoDesatualizado");
  if (
    typeof diasPrecoInsumoDesatualizadoBruto !== "string" ||
    diasPrecoInsumoDesatualizadoBruto.trim() === ""
  ) {
    return {
      ok: false,
      mensagem: 'Preencha o campo "Dias para avisar preço de insumo desatualizado".',
    };
  }
  const diasPrecoInsumoDesatualizado = Number(diasPrecoInsumoDesatualizadoBruto);
  if (!Number.isInteger(diasPrecoInsumoDesatualizado) || diasPrecoInsumoDesatualizado <= 0) {
    return {
      ok: false,
      mensagem:
        'Dias para avisar preço de insumo desatualizado precisa ser um número inteiro maior que zero.',
    };
  }

  // Achado N13 da auditoria de abrangência — faixa de gramatura aceita pelo
  // validador do offset (ver validarPedidoOffset em src/lib/pricing/validar.ts).
  // Mesmo cuidado de presença dos blocos acima (campo ausente/"" não pode
  // virar 0 silenciosamente).
  const gramaturaMinGm2Bruto = formData.get("gramaturaMinGm2");
  if (typeof gramaturaMinGm2Bruto !== "string" || gramaturaMinGm2Bruto.trim() === "") {
    return { ok: false, mensagem: 'Preencha o campo "Gramatura mínima (g/m²)".' };
  }
  const gramaturaMinGm2 = Number(gramaturaMinGm2Bruto);
  if (!Number.isFinite(gramaturaMinGm2) || gramaturaMinGm2 <= 0) {
    return {
      ok: false,
      mensagem: 'Gramatura mínima (g/m²) precisa ser um número maior que zero.',
    };
  }
  const gramaturaMaxGm2Bruto = formData.get("gramaturaMaxGm2");
  if (typeof gramaturaMaxGm2Bruto !== "string" || gramaturaMaxGm2Bruto.trim() === "") {
    return { ok: false, mensagem: 'Preencha o campo "Gramatura máxima (g/m²)".' };
  }
  const gramaturaMaxGm2 = Number(gramaturaMaxGm2Bruto);
  if (!Number.isFinite(gramaturaMaxGm2) || gramaturaMaxGm2 <= 0) {
    return {
      ok: false,
      mensagem: 'Gramatura máxima (g/m²) precisa ser um número maior que zero.',
    };
  }
  if (gramaturaMinGm2 >= gramaturaMaxGm2) {
    return {
      ok: false,
      mensagem: 'A "Gramatura mínima" precisa ser menor que a "Gramatura máxima".',
    };
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
      mostrarEspecificacoesTecnicas,
      diasValidadeOrcamentoPadrao,
      diasAlertaOrcamentoParado,
      alertaPrazoAtivo,
      alertaPrazoLimiar1Dias: limiaresPrazo.alertaPrazoLimiar1Dias,
      alertaPrazoLimiar2Dias: limiaresPrazo.alertaPrazoLimiar2Dias,
      alertaPrazoLimiar3Dias: limiaresPrazo.alertaPrazoLimiar3Dias,
      custoAutomaticoConsumo,
      categoriaCustoConsumoPadraoId,
      perdaEhCustoDoPedido,
      comissaoEntraNoCustoPedido,
      bloqueiaAoUltrapassarLimiteCredito,
      margemFaixaBaixa: percentuaisInteiros.margemFaixaBaixa,
      margemFaixaBoa: percentuaisInteiros.margemFaixaBoa,
      descontoMaxSemAprovacao: percentuaisInteiros.descontoMaxSemAprovacao,
      toleranciaTiragemPadraoPercent: percentuaisInteiros.toleranciaTiragemPadraoPercent,
      toleranciaTiragemPercent: percentuaisInteiros.toleranciaTiragemPercent,
      diasPrecoInsumoDesatualizado,
      prazoEmDiasUteis,
      diasFuncionamento,
      gramaturaMinGm2,
      gramaturaMaxGm2,
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

  const mostrarEspecificacoesTecnicasAntes = parametrosAntes?.mostrarEspecificacoesTecnicas ?? true;
  if (mostrarEspecificacoesTecnicasAntes !== mostrarEspecificacoesTecnicas) {
    antesTextos.push(`Especificações técnicas no orçamento do cliente: ${mostrarEspecificacoesTecnicasAntes ? "visíveis" : "ocultas"}`);
    depoisTextos.push(`Especificações técnicas no orçamento do cliente: ${mostrarEspecificacoesTecnicas ? "visíveis" : "ocultas"}`);
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

  if ((parametrosAntes?.custoAutomaticoConsumo ?? true) !== custoAutomaticoConsumo) {
    antesTextos.push(
      `Custo automático de consumo: ${(parametrosAntes?.custoAutomaticoConsumo ?? true) ? "ligado" : "desligado"}`
    );
    depoisTextos.push(`Custo automático de consumo: ${custoAutomaticoConsumo ? "ligado" : "desligado"}`);
  }
  if ((parametrosAntes?.perdaEhCustoDoPedido ?? true) !== perdaEhCustoDoPedido) {
    antesTextos.push(
      `Perda de calibragem conta como custo do pedido: ${(parametrosAntes?.perdaEhCustoDoPedido ?? true) ? "sim" : "não"}`
    );
    depoisTextos.push(`Perda de calibragem conta como custo do pedido: ${perdaEhCustoDoPedido ? "sim" : "não"}`);
  }
  if ((parametrosAntes?.comissaoEntraNoCustoPedido ?? false) !== comissaoEntraNoCustoPedido) {
    antesTextos.push(
      `Comissão do vendedor entra no custo do pedido: ${(parametrosAntes?.comissaoEntraNoCustoPedido ?? false) ? "sim" : "não"}`
    );
    depoisTextos.push(
      `Comissão do vendedor entra no custo do pedido: ${comissaoEntraNoCustoPedido ? "sim" : "não"}`
    );
  }
  if ((parametrosAntes?.bloqueiaAoUltrapassarLimiteCredito ?? false) !== bloqueiaAoUltrapassarLimiteCredito) {
    antesTextos.push(
      `Bloquear ao ultrapassar limite de crédito: ${(parametrosAntes?.bloqueiaAoUltrapassarLimiteCredito ?? false) ? "sim" : "não"}`
    );
    depoisTextos.push(
      `Bloquear ao ultrapassar limite de crédito: ${bloqueiaAoUltrapassarLimiteCredito ? "sim" : "não"}`
    );
  }

  const categoriaCustoConsumoPadraoIdAntes = parametrosAntes?.categoriaCustoConsumoPadraoId ?? null;
  if (categoriaCustoConsumoPadraoIdAntes !== categoriaCustoConsumoPadraoId) {
    // Resolve nome legível pro log em vez do id cru — só busca os 2 ids
    // realmente envolvidos (nenhuma query se os dois forem null).
    const idsParaResolver = [categoriaCustoConsumoPadraoIdAntes, categoriaCustoConsumoPadraoId].filter(
      (id): id is string => id !== null
    );
    const categoriasResolvidas =
      idsParaResolver.length > 0
        ? await prisma.categoriaCusto.findMany({
            where: { id: { in: idsParaResolver } },
            select: { id: true, nome: true },
          })
        : [];
    const nomePorId = new Map(categoriasResolvidas.map((c) => [c.id, c.nome]));
    antesTextos.push(
      `Categoria de custo padrão: ${categoriaCustoConsumoPadraoIdAntes ? (nomePorId.get(categoriaCustoConsumoPadraoIdAntes) ?? "categoria removida") : "— (primeira ativa por ordem)"}`
    );
    depoisTextos.push(
      `Categoria de custo padrão: ${categoriaCustoConsumoPadraoId ? (nomePorId.get(categoriaCustoConsumoPadraoId) ?? "categoria removida") : "— (primeira ativa por ordem)"}`
    );
  }

  for (const campo of CAMPOS_PERCENTUAL_INTEIRO) {
    const antes = parametrosAntes ? Number(parametrosAntes[campo]) : null;
    const depois = percentuaisInteiros[campo];
    if (antes === null || antes !== depois) {
      antesTextos.push(`${ROTULO_PERCENTUAL_INTEIRO[campo]}: ${antes === null ? "—" : `${antes}%`}`);
      depoisTextos.push(`${ROTULO_PERCENTUAL_INTEIRO[campo]}: ${depois}%`);
    }
  }

  const diasPrecoInsumoDesatualizadoAntes = parametrosAntes?.diasPrecoInsumoDesatualizado ?? 90;
  if (diasPrecoInsumoDesatualizadoAntes !== diasPrecoInsumoDesatualizado) {
    antesTextos.push(`Dias para avisar preço de insumo desatualizado: ${diasPrecoInsumoDesatualizadoAntes}`);
    depoisTextos.push(`Dias para avisar preço de insumo desatualizado: ${diasPrecoInsumoDesatualizado}`);
  }

  const gramaturaMinGm2Antes = parametrosAntes ? Number(parametrosAntes.gramaturaMinGm2) : 30;
  if (gramaturaMinGm2Antes !== gramaturaMinGm2) {
    antesTextos.push(`Gramatura mínima aceita: ${gramaturaMinGm2Antes} g/m²`);
    depoisTextos.push(`Gramatura mínima aceita: ${gramaturaMinGm2} g/m²`);
  }
  const gramaturaMaxGm2Antes = parametrosAntes ? Number(parametrosAntes.gramaturaMaxGm2) : 500;
  if (gramaturaMaxGm2Antes !== gramaturaMaxGm2) {
    antesTextos.push(`Gramatura máxima aceita: ${gramaturaMaxGm2Antes} g/m²`);
    depoisTextos.push(`Gramatura máxima aceita: ${gramaturaMaxGm2} g/m²`);
  }

  const prazoEmDiasUteisAntes = parametrosAntes?.prazoEmDiasUteis ?? true;
  if (prazoEmDiasUteisAntes !== prazoEmDiasUteis) {
    antesTextos.push(`Prazo em dias úteis: ${prazoEmDiasUteisAntes ? "sim" : "não"}`);
    depoisTextos.push(`Prazo em dias úteis: ${prazoEmDiasUteis ? "sim" : "não"}`);
  }
  const diasFuncionamentoAntes = parametrosAntes?.diasFuncionamento ?? 31;
  if (diasFuncionamentoAntes !== diasFuncionamento) {
    antesTextos.push(`Dias de funcionamento: ${formatarDiasFuncionamento(diasFuncionamentoAntes)}`);
    depoisTextos.push(`Dias de funcionamento: ${formatarDiasFuncionamento(diasFuncionamento)}`);
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
