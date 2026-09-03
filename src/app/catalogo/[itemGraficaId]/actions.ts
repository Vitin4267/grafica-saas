"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { parseJsonArray } from "@/lib/form-json";
import { resolverItemParaNcm } from "@/lib/catalogo-ncm";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { D } from "@/lib/pricing/decimal";
import { calcularDeltaAjusteInventario } from "@/lib/estoque-manual";
import { UNIDADES_COMPRA, type UnidadeCompra } from "@/lib/unidade-compra";

const formatoQuantidade = new Intl.NumberFormat("pt-BR");

function formatarPreco(valor: unknown): string {
  return valor === null || valor === undefined ? "—" : formatoMoeda.format(Number(valor));
}

function formatarQuantidade(valor: unknown): string {
  return valor === null || valor === undefined ? "—" : formatoQuantidade.format(Number(valor));
}

const MENSAGEM_ESTOQUE_DIVERGENTE =
  "O estoque deste item mudou desde que a página foi aberta (provavelmente uma baixa de produção) — recarregue a página e lance de novo.";

// Sinaliza, de dentro da transação, que o estoque mudou entre a leitura
// (resolverItemMateriaPrima, antes da transação) e a escrita — usado só pra
// abortar a transação inteira com mensagem amigável. Achado de auditoria
// pré-lançamento (2026-08-15): os 3 lançamentos manuais abaixo (entrada de
// compra, saída manual, ajuste de inventário) gravavam estoqueAtual com um
// `update` simples, sem comparar com o valor lido — igual ao bug que
// salvarCatalogo/salvarVariantesMateriaPrima (catalogo/actions.ts) já
// corrigiram com compare-and-swap. Sem isso, uma baixa de produção
// concorrente (pedido avançando de status enquanto este form ficava aberto)
// era silenciosamente apagada do saldo corrente pelo valor "absoluto" que
// este form calculava em cima do estoque desatualizado que tinha lido.
class ErroEstoqueDivergente extends Error {}

export type SalvarConfigResult = { ok: boolean; mensagem: string };

const modeloCalculoSchema = z.enum([
  "SIMPLES",
  "M2",
  "OFFSET",
  "FLEXOGRAFIA",
  "DIGITAL",
  "SERIGRAFIA",
  "SUBLIMACAO",
  "ESTAMPAGEM_QUENTE",
  "PERSONALIZACAO",
  "REVENDA",
  "BORDADO",
  "TEMPO_MAQUINA",
]);
// Sem OUTRO de propósito: unidadeContagem não tem campo "outro" livre (só
// ItemCatalogo.unidade tem), então OUTRO aqui só mostraria o rótulo genérico
// "outro" na exibição de preço — melhor nem oferecer a opção.
const unidadeContagemSchema = z.enum([
  "FOLHA",
  "METRO_QUADRADO",
  "METRO_LINEAR",
  "UNIDADE",
  "LITRO",
  "KG",
  "ROLO",
  "PACOTE",
  "CENTO",
  "MILHEIRO",
  "HORA",
]);
const baseCobrancaSchema = z.enum([
  "UNIDADE",
  "M2",
  "FOLHA_IMPRESSA",
  "METRO_LINEAR",
  "FIXO",
  "HORA",
]);
const estagioSchema = z.enum(["PRE_REFILE", "POS_REFILE"]);

const bobinaSchema = z.object({
  larguraNominal: z.coerce.number().positive("Largura nominal deve ser maior que zero."),
  refile: z.coerce.number().min(0, "Refile não pode ser negativo."),
});

const formatoFolhaSchema = z.object({
  nome: z.string().trim().min(1, "Informe um nome para o formato de folha."),
  larguraFolha: z.coerce.number().positive("Largura da folha deve ser maior que zero."),
  alturaFolha: z.coerce.number().positive("Altura da folha deve ser maior que zero."),
});

const fichaTecnicaItemSchema = z.object({
  materiaPrimaId: z.string().min(1, "Selecione uma matéria-prima."),
  varianteId: z.string().min(1).optional(),
  quantidadePorUnidade: z.coerce
    .number()
    .positive("Quantidade por unidade deve ser maior que zero."),
});

const linhaGramaturaSchema = z.object({
  gramatura: z.coerce
    .number()
    .int("Gramatura deve ser um número inteiro.")
    .min(30, "Gramatura mínima é 30 g/m².")
    .max(600, "Gramatura máxima é 600 g/m²."),
  precoKg: z.coerce.number().positive("Preço por kg deve ser maior que zero."),
});

const linhaVarianteSchema = z.object({
  id: z.string().min(1).optional(), // ausente = variante nova
  rotulo: z.string().trim().min(1, "Informe um rótulo pra variante.").max(40),
  precoCompra: z.coerce.number().positive("Preço de compra deve ser maior que zero."),
  estoqueAtual: z.coerce.number().min(0, "Estoque atual não pode ser negativo.").optional(),
  // Valor de estoqueAtual como a TELA leu no carregamento da página — usado só
  // pra compare-and-swap em salvarVariantesMateriaPrima, nunca gravado
  // sozinho. Evita apagar uma baixa de produção que aconteceu enquanto a aba
  // de Catálogo ficou aberta (mesma correção de salvarCatalogo, ver
  // src/app/catalogo/actions.ts).
  estoqueAtualOriginal: z.coerce.number().min(0).optional(),
  estoqueMinimo: z.coerce.number().min(0, "Estoque mínimo não pode ser negativo.").optional(),
  perdaFixaPadrao: z.coerce.number().min(0, "Perda fixa não pode ser negativa.").optional(),
});

export async function salvarModeloProduto(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const modeloParsed = modeloCalculoSchema.safeParse(formData.get("modeloCalculo"));
  if (!modeloParsed.success) {
    return { ok: false, mensagem: "Modelo de cálculo inválido." };
  }
  const modeloCalculo = modeloParsed.data;

  // Unidade em que a gráfica vende este produto (ex: rótulo por milheiro) —
  // camada de exibição derivada, nunca mexe no motor de preço (ver
  // src/lib/unidade-contagem.ts e comentário do campo no schema). Vale pros
  // 3 modelos de cálculo, não só M2/OFFSET.
  const unidadeContagemRaw = String(formData.get("unidadeContagem") || "");
  const unidadeContagemParsed = unidadeContagemRaw
    ? unidadeContagemSchema.safeParse(unidadeContagemRaw)
    : null;
  if (unidadeContagemRaw && !unidadeContagemParsed?.success) {
    return { ok: false, mensagem: "Unidade de venda inválida." };
  }
  const unidadeContagem = unidadeContagemParsed?.success ? unidadeContagemParsed.data : null;
  const fatorConversaoRaw = formData.get("fatorConversao");
  const fatorConversao = fatorConversaoRaw ? Number(fatorConversaoRaw) : null;
  if (fatorConversao !== null && (!Number.isFinite(fatorConversao) || fatorConversao <= 0)) {
    return { ok: false, mensagem: "Fator de conversão da unidade de venda inválido." };
  }
  // As duas coisas andam juntas — unidade sem fator (ou vice-versa) não tem
  // como converter preço nenhum, então trata como "não configurado" em vez
  // de gravar um par incompleto.
  const unidadeContagemFinal = unidadeContagem && fatorConversao ? unidadeContagem : null;
  const fatorConversaoFinal = unidadeContagem && fatorConversao ? fatorConversao : null;

  const ROTULO_MODELO: Record<typeof modeloCalculo, string> = {
    SIMPLES: "Simples",
    M2: "M² (flexografia)",
    OFFSET: "Offset",
    FLEXOGRAFIA: "Flexografia",
    DIGITAL: "Digital",
    SERIGRAFIA: "Serigrafia",
    SUBLIMACAO: "Sublimação",
    ESTAMPAGEM_QUENTE: "Estampagem a quente",
    PERSONALIZACAO: "Personalização (tampografia, laser, DTG, transfer)",
    REVENDA: "Revenda / terceirização",
    BORDADO: "Bordado",
    TEMPO_MAQUINA: "Tempo de máquina (corte a laser, router, plotter)",
  };
  const modeloAntes = ROTULO_MODELO[itemGrafica.modeloCalculo as typeof modeloCalculo] ?? itemGrafica.modeloCalculo;

  try {
    if (modeloCalculo === "SIMPLES") {
      // Achado N1 — só lido/gravado no branch SIMPLES: nos outros modelos de
      // cálculo o checkbox nem aparece no form, então o campo permanece com
      // o valor que já estava no banco (sem esta escrita).
      const simplesCobraPorArea = formData.get("simplesCobraPorArea") === "on";
      await prisma.itemGrafica.update({
        where: { id: itemGraficaId },
        data: {
          modeloCalculo: "SIMPLES",
          simplesCobraPorArea,
          unidadeContagem: unidadeContagemFinal,
          fatorConversao: fatorConversaoFinal,
        },
      });

      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.salvar_modelo_calculo",
        entidade: "ItemGrafica",
        entidadeId: itemGraficaId,
        descricao: "Modelo de cálculo do item atualizado",
        valorAnterior: `Modelo: ${modeloAntes}`,
        valorNovo: `Modelo: ${ROTULO_MODELO.SIMPLES}`,
      });
    } else if (modeloCalculo === "M2") {
      const bobinasResult = parseJsonArray(formData.get("bobinasJson"), bobinaSchema);
      if (!bobinasResult.ok) {
        return { ok: false, mensagem: bobinasResult.mensagem };
      }
      if (bobinasResult.data.length === 0) {
        return {
          ok: false,
          mensagem: "Adicione ao menos uma bobina para habilitar o cálculo M2.",
        };
      }

      const custoImpressaoM2 = Number(formData.get("custoImpressaoM2") || 0);
      const areaMinimaFaturavel = Number(formData.get("areaMinimaFaturavel") || 0);
      if (!Number.isFinite(custoImpressaoM2) || custoImpressaoM2 < 0) {
        return { ok: false, mensagem: "Custo de impressão por m² inválido." };
      }
      if (!Number.isFinite(areaMinimaFaturavel) || areaMinimaFaturavel < 0) {
        return { ok: false, mensagem: "Área mínima faturável inválida." };
      }

      await prisma.$transaction([
        prisma.itemGrafica.update({
          where: { id: itemGraficaId },
          data: {
            modeloCalculo: "M2",
            custoImpressaoM2,
            areaMinimaFaturavel,
            unidadeContagem: unidadeContagemFinal,
            fatorConversao: fatorConversaoFinal,
          },
        }),
        prisma.bobinaMaterial.deleteMany({ where: { itemGraficaId } }),
        prisma.bobinaMaterial.createMany({
          data: bobinasResult.data.map((b) => ({ itemGraficaId, ...b })),
        }),
      ]);

      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.salvar_modelo_calculo",
        entidade: "ItemGrafica",
        entidadeId: itemGraficaId,
        descricao: "Modelo de cálculo do item atualizado para M²",
        valorAnterior: `Modelo: ${modeloAntes}, custo impressão/m²: ${formatarPreco(itemGrafica.custoImpressaoM2)}, área mínima: ${formatarQuantidade(itemGrafica.areaMinimaFaturavel)}`,
        valorNovo: `Modelo: ${ROTULO_MODELO.M2}, custo impressão/m²: ${formatarPreco(custoImpressaoM2)}, área mínima: ${formatarQuantidade(areaMinimaFaturavel)}, ${bobinasResult.data.length} bobina${bobinasResult.data.length > 1 ? "s" : ""}`,
      });
    } else if (modeloCalculo === "OFFSET") {
      const formatosResult = parseJsonArray(
        formData.get("formatosFolhaJson"),
        formatoFolhaSchema
      );
      if (!formatosResult.ok) {
        return { ok: false, mensagem: formatosResult.mensagem };
      }
      if (formatosResult.data.length === 0) {
        return {
          ok: false,
          mensagem: "Adicione ao menos um formato de folha para habilitar o cálculo Offset.",
        };
      }

      const viraFolha = formData.get("viraFolha") === "on";
      const gramaturaGm2 = Number(formData.get("gramaturaGm2") || 0);
      if (!Number.isFinite(gramaturaGm2) || gramaturaGm2 < 30 || gramaturaGm2 > 500) {
        return { ok: false, mensagem: "Gramatura deve estar entre 30 e 500 g/m²." };
      }

      const prensaId = String(formData.get("prensaId") ?? "");
      if (!prensaId) {
        return { ok: false, mensagem: "Selecione uma prensa para habilitar o cálculo Offset." };
      }
      const prensaValida = await prisma.prensa.findFirst({
        where: { id: prensaId, graficaId: usuario.graficaId, ativa: true },
        select: { id: true },
      });
      if (!prensaValida) {
        return { ok: false, mensagem: "Prensa selecionada é inválida." };
      }

      const papelId = String(formData.get("papelId") ?? "");
      if (!papelId) {
        return { ok: false, mensagem: "Selecione um papel para habilitar o cálculo Offset." };
      }
      const papelValido = await prisma.itemGrafica.findFirst({
        where: {
          id: papelId,
          graficaId: usuario.graficaId,
          itemCatalogo: { tipo: "MATERIA_PRIMA" },
        },
        select: { id: true },
      });
      if (!papelValido) {
        return { ok: false, mensagem: "Papel selecionado é inválido." };
      }

      await prisma.$transaction([
        prisma.itemGrafica.update({
          where: { id: itemGraficaId },
          data: {
            modeloCalculo: "OFFSET",
            viraFolha,
            gramaturaGm2,
            prensaId,
            papelId,
            unidadeContagem: unidadeContagemFinal,
            fatorConversao: fatorConversaoFinal,
          },
        }),
        prisma.formatoFolha.deleteMany({ where: { itemGraficaId } }),
        prisma.formatoFolha.createMany({
          data: formatosResult.data.map((f) => ({ itemGraficaId, ...f })),
        }),
      ]);

      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.salvar_modelo_calculo",
        entidade: "ItemGrafica",
        entidadeId: itemGraficaId,
        descricao: "Modelo de cálculo do item atualizado para Offset",
        valorAnterior: `Modelo: ${modeloAntes}, gramatura: ${formatarQuantidade(itemGrafica.gramaturaGm2)}g/m²`,
        valorNovo: `Modelo: ${ROTULO_MODELO.OFFSET}, gramatura: ${formatarQuantidade(gramaturaGm2)}g/m², ${formatosResult.data.length} formato${formatosResult.data.length > 1 ? "s" : ""} de folha`,
      });
    } else if (modeloCalculo === "FLEXOGRAFIA") {
      const bobinasResult = parseJsonArray(formData.get("bobinasJson"), bobinaSchema);
      if (!bobinasResult.ok) {
        return { ok: false, mensagem: bobinasResult.mensagem };
      }
      if (bobinasResult.data.length === 0) {
        return {
          ok: false,
          mensagem: "Adicione ao menos uma bobina para habilitar o cálculo Flexografia.",
        };
      }

      const custoClichePorCm2 = Number(formData.get("custoClichePorCm2Flexo") || 0);
      if (!Number.isFinite(custoClichePorCm2) || custoClichePorCm2 < 0) {
        return { ok: false, mensagem: "Custo do clichê inválido." };
      }

      const maquinaFlexografiaId = String(formData.get("maquinaFlexografiaId") ?? "");
      if (!maquinaFlexografiaId) {
        return {
          ok: false,
          mensagem: "Selecione uma máquina para habilitar o cálculo Flexografia.",
        };
      }
      const maquinaValida = await prisma.maquinaFlexografia.findFirst({
        where: { id: maquinaFlexografiaId, graficaId: usuario.graficaId, ativa: true },
        select: { id: true },
      });
      if (!maquinaValida) {
        return { ok: false, mensagem: "Máquina selecionada é inválida." };
      }

      await prisma.$transaction([
        prisma.itemGrafica.update({
          where: { id: itemGraficaId },
          data: {
            modeloCalculo: "FLEXOGRAFIA",
            maquinaFlexografiaId,
            unidadeContagem: unidadeContagemFinal,
            fatorConversao: fatorConversaoFinal,
          },
        }),
        prisma.bobinaMaterial.deleteMany({ where: { itemGraficaId } }),
        prisma.bobinaMaterial.createMany({
          data: bobinasResult.data.map((b) => ({ itemGraficaId, ...b })),
        }),
        prisma.configuracaoClicheFlexografia.upsert({
          where: { itemGraficaId },
          update: { custoClichePorCm2 },
          create: { itemGraficaId, custoClichePorCm2 },
        }),
      ]);

      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.salvar_modelo_calculo",
        entidade: "ItemGrafica",
        entidadeId: itemGraficaId,
        descricao: "Modelo de cálculo do item atualizado para Flexografia",
        valorAnterior: `Modelo: ${modeloAntes}`,
        valorNovo: `Modelo: ${ROTULO_MODELO.FLEXOGRAFIA}, custo clichê/cm²: ${formatarPreco(custoClichePorCm2)}, ${bobinasResult.data.length} bobina${bobinasResult.data.length > 1 ? "s" : ""}`,
      });
    } else if (modeloCalculo === "DIGITAL") {
      // Sem nesting — nenhuma bobina/folha, só a impressora escolhida (ver
      // "dimensões opcionais" no motor, src/lib/pricing/digital.ts).
      const impressoraDigitalId = String(formData.get("impressoraDigitalId") ?? "");
      if (!impressoraDigitalId) {
        return {
          ok: false,
          mensagem: "Selecione uma impressora digital para habilitar o cálculo Digital.",
        };
      }
      const impressoraValida = await prisma.impressoraDigital.findFirst({
        where: { id: impressoraDigitalId, graficaId: usuario.graficaId, ativa: true },
        select: { id: true },
      });
      if (!impressoraValida) {
        return { ok: false, mensagem: "Impressora digital selecionada é inválida." };
      }

      await prisma.itemGrafica.update({
        where: { id: itemGraficaId },
        data: {
          modeloCalculo: "DIGITAL",
          impressoraDigitalId,
          unidadeContagem: unidadeContagemFinal,
          fatorConversao: fatorConversaoFinal,
        },
      });

      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.salvar_modelo_calculo",
        entidade: "ItemGrafica",
        entidadeId: itemGraficaId,
        descricao: "Modelo de cálculo do item atualizado para Digital",
        valorAnterior: `Modelo: ${modeloAntes}`,
        valorNovo: `Modelo: ${ROTULO_MODELO.DIGITAL}`,
      });
    } else if (
      modeloCalculo === "SERIGRAFIA" ||
      modeloCalculo === "SUBLIMACAO" ||
      modeloCalculo === "ESTAMPAGEM_QUENTE" ||
      modeloCalculo === "PERSONALIZACAO"
    ) {
      // SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE/PERSONALIZACAO usam a mesma
      // tabela MaquinaSetupPorPeca. Os 3 primeiros filtram por
      // tipoProcesso === modeloCalculo (o nome do enum ProcessoSetupPorPeca é
      // IDÊNTICO ao do ModeloCalculo correspondente de propósito, então dá
      // pra usar modeloCalculo direto como filtro, sem tabela de tradução).
      // PERSONALIZACAO (achado A3 da auditoria de abrangência) não tem
      // processo homônimo — aceita qualquer máquina cujo tipoProcesso seja
      // um dos processos "genéricos" (TAMPOGRAFIA/GRAVACAO_LASER/DTG/
      // TRANSFER/OUTRO), ou seja, qualquer um que NÃO seja um dos 3 já
      // mapeados 1:1. Sem nesting, igual a Digital.
      const maquinaSetupPorPecaId = String(formData.get("maquinaSetupPorPecaId") ?? "");
      if (!maquinaSetupPorPecaId) {
        return {
          ok: false,
          mensagem: `Selecione uma máquina para habilitar o cálculo ${ROTULO_MODELO[modeloCalculo]}.`,
        };
      }
      const maquinaValida = await prisma.maquinaSetupPorPeca.findFirst({
        where: {
          id: maquinaSetupPorPecaId,
          graficaId: usuario.graficaId,
          ativa: true,
          tipoProcesso:
            modeloCalculo === "PERSONALIZACAO"
              ? { notIn: ["SERIGRAFIA", "SUBLIMACAO", "ESTAMPAGEM_QUENTE"] }
              : modeloCalculo,
        },
        select: { id: true },
      });
      if (!maquinaValida) {
        return {
          ok: false,
          mensagem: `Máquina selecionada é inválida para o modelo ${ROTULO_MODELO[modeloCalculo]}.`,
        };
      }

      await prisma.itemGrafica.update({
        where: { id: itemGraficaId },
        data: {
          modeloCalculo,
          maquinaSetupPorPecaId,
          unidadeContagem: unidadeContagemFinal,
          fatorConversao: fatorConversaoFinal,
        },
      });

      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.salvar_modelo_calculo",
        entidade: "ItemGrafica",
        entidadeId: itemGraficaId,
        descricao: `Modelo de cálculo do item atualizado para ${ROTULO_MODELO[modeloCalculo]}`,
        valorAnterior: `Modelo: ${modeloAntes}`,
        valorNovo: `Modelo: ${ROTULO_MODELO[modeloCalculo]}`,
      });
    } else if (modeloCalculo === "REVENDA") {
      // Revenda/terceirização (achado A12 da auditoria de abrangência) — sem
      // máquina, sem bobina/papel: o custo vem de ItemGrafica.precoCompra
      // (mesmo campo que DIGITAL/setup-por-peça já usam como custo de
      // substrato), com override opcional POR ORÇAMENTO em
      // OrcamentoItem.custoAquisicaoUnitario.
      await prisma.itemGrafica.update({
        where: { id: itemGraficaId },
        data: {
          modeloCalculo: "REVENDA",
          unidadeContagem: unidadeContagemFinal,
          fatorConversao: fatorConversaoFinal,
        },
      });

      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.salvar_modelo_calculo",
        entidade: "ItemGrafica",
        entidadeId: itemGraficaId,
        descricao: `Modelo de cálculo do item atualizado para ${ROTULO_MODELO.REVENDA}`,
        valorAnterior: `Modelo: ${modeloAntes}`,
        valorNovo: `Modelo: ${ROTULO_MODELO.REVENDA}`,
      });
    } else if (modeloCalculo === "BORDADO") {
      // Achado A4 da auditoria de abrangência — bordado cobra por PONTO da
      // arte de cada pedido (ver OrcamentoItem.numeroPontos), não por peça
      // fixa como setup-por-peça: máquina própria (MaquinaBordado), sem
      // bobina/papel/formato.
      const maquinaBordadoId = String(formData.get("maquinaBordadoId") ?? "");
      if (!maquinaBordadoId) {
        return {
          ok: false,
          mensagem: "Selecione uma máquina para habilitar o cálculo Bordado.",
        };
      }
      const maquinaValida = await prisma.maquinaBordado.findFirst({
        where: { id: maquinaBordadoId, graficaId: usuario.graficaId, ativa: true },
        select: { id: true },
      });
      if (!maquinaValida) {
        return { ok: false, mensagem: "Máquina selecionada é inválida." };
      }

      await prisma.itemGrafica.update({
        where: { id: itemGraficaId },
        data: {
          modeloCalculo: "BORDADO",
          maquinaBordadoId,
          unidadeContagem: unidadeContagemFinal,
          fatorConversao: fatorConversaoFinal,
        },
      });

      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.salvar_modelo_calculo",
        entidade: "ItemGrafica",
        entidadeId: itemGraficaId,
        descricao: `Modelo de cálculo do item atualizado para ${ROTULO_MODELO.BORDADO}`,
        valorAnterior: `Modelo: ${modeloAntes}`,
        valorNovo: `Modelo: ${ROTULO_MODELO.BORDADO}`,
      });
    } else if (modeloCalculo === "TEMPO_MAQUINA") {
      // Achado A6 da auditoria de abrangência — corte/gravação a laser,
      // router CNC, plotter de recorte: cobra por tempo de máquina e/ou
      // metro de corte (ver OrcamentoItem.tempoEstimadoMin/metrosCorte),
      // máquina própria (MaquinaTempo), sem bobina/papel/formato.
      const maquinaTempoId = String(formData.get("maquinaTempoId") ?? "");
      if (!maquinaTempoId) {
        return {
          ok: false,
          mensagem: "Selecione uma máquina para habilitar o cálculo Tempo de máquina.",
        };
      }
      const maquinaValida = await prisma.maquinaTempo.findFirst({
        where: { id: maquinaTempoId, graficaId: usuario.graficaId, ativa: true },
        select: { id: true },
      });
      if (!maquinaValida) {
        return { ok: false, mensagem: "Máquina selecionada é inválida." };
      }

      await prisma.itemGrafica.update({
        where: { id: itemGraficaId },
        data: {
          modeloCalculo: "TEMPO_MAQUINA",
          maquinaTempoId,
          unidadeContagem: unidadeContagemFinal,
          fatorConversao: fatorConversaoFinal,
        },
      });

      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.salvar_modelo_calculo",
        entidade: "ItemGrafica",
        entidadeId: itemGraficaId,
        descricao: `Modelo de cálculo do item atualizado para ${ROTULO_MODELO.TEMPO_MAQUINA}`,
        valorAnterior: `Modelo: ${modeloAntes}`,
        valorNovo: `Modelo: ${ROTULO_MODELO.TEMPO_MAQUINA}`,
      });
    }
  } catch {
    return {
      ok: false,
      mensagem:
        "Não foi possível salvar — confira se os valores numéricos estão dentro do intervalo permitido.",
    };
  }

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  revalidatePath("/orcamento");
  return { ok: true, mensagem: "Configuração salva com sucesso!" };
}

export async function salvarNcm(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemCatalogoId = String(formData.get("itemCatalogoId"));

  const resolvido = await resolverItemParaNcm(itemCatalogoId, usuario.graficaId);
  if (!resolvido.ok) {
    return {
      ok: false,
      mensagem:
        resolvido.motivo === "item_mestre"
          ? "Este item é do catálogo compartilhado e não pode ter o NCM editado por aqui."
          : "Item não encontrado.",
    };
  }

  const ncm = String(formData.get("ncm") ?? "").trim();

  // Lido ANTES do update pro log de auditoria — NCM errado é nota fiscal
  // rejeitada pela SEFAZ, e saber quem trocou e de qual valor pro qual é o
  // que resolve a investigação depois.
  const anterior = await prisma.itemCatalogo.findUnique({
    where: { id: itemCatalogoId },
    select: { nome: true, ncm: true },
  });

  await prisma.itemCatalogo.update({
    where: { id: itemCatalogoId },
    data: { ncm: ncm || null },
  });

  if (anterior && (anterior.ncm ?? "") !== ncm) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "catalogo.salvar_ncm",
      entidade: "ItemCatalogo",
      entidadeId: itemCatalogoId,
      descricao: `NCM de "${anterior.nome}" alterado`,
      valorAnterior: anterior.ncm ?? "sem NCM",
      valorNovo: ncm || "sem NCM",
    });
  }

  revalidatePath(`/catalogo/${resolvido.itemGraficaId}`);
  revalidatePath("/catalogo");
  return { ok: true, mensagem: "NCM salvo com sucesso!" };
}

export type SalvarQuantidadePorEmbalagemResult = SalvarConfigResult;

const quantidadePorEmbalagemSchema = z.coerce
  .number()
  .min(0, "Quantidade por embalagem não pode ser negativa.")
  .optional();

// Puramente informativo (ver AGENTS.md do módulo/plano da feature): esse
// fator de conversão nunca é lido por lançamento de estoque, ficha técnica
// ou custo — só multiplica estoqueAtual na exibição. estoqueAtual continua
// significando exatamente "quantas unidades cadastradas" como hoje.
export async function salvarQuantidadePorEmbalagem(
  _estadoAnterior: SalvarQuantidadePorEmbalagemResult | null,
  formData: FormData
): Promise<SalvarQuantidadePorEmbalagemResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  // String vazia = "sem conversão configurada" (null), não erro de validação.
  const bruto = formData.get("quantidadePorEmbalagem");
  const brutoLimpo = typeof bruto === "string" && bruto.trim() === "" ? undefined : bruto;
  const parsed = quantidadePorEmbalagemSchema.safeParse(brutoLimpo);
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Valor inválido." };
  }

  await prisma.itemGrafica.update({
    where: { id: itemGraficaId },
    data: { quantidadePorEmbalagem: parsed.data ?? null },
  });

  revalidatePath(`/catalogo/${itemGraficaId}`);
  return { ok: true, mensagem: "Salvo." };
}

export type SalvarConfiguracaoCompraResult = SalvarConfigResult;

const configuracaoCompraSchema = z.object({
  unidadeCompraPadrao: z.enum(UNIDADES_COMPRA as [UnidadeCompra, ...UnidadeCompra[]]).optional(),
  unidadeCompraPadraoOutro: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : undefined)),
  fatorConversaoCompraPadrao: z.coerce
    .number()
    .positive("Fator de conversão deve ser maior que zero.")
    .optional(),
  loteMinimoCompra: z.coerce.number().positive("Lote mínimo deve ser maior que zero.").optional(),
  multiploCompra: z.coerce.number().positive("Múltiplo de compra deve ser maior que zero.").optional(),
});

// Achado A6 da auditoria de abrangência (Parte 3/Compras): configuração
// padrão de unidade de compra deste item — só pré-preenche e avisa na tela
// de nova solicitação de compra (ver src/app/compras/nova/NovaSolicitacaoForm.tsx),
// nunca obrigatório e nunca muda como estoque é lançado (mesmo espírito
// puramente informativo de salvarQuantidadePorEmbalagem acima). Qualquer
// campo deixado em branco no formulário volta a null (limpa a configuração).
export async function salvarConfiguracaoCompra(
  _estadoAnterior: SalvarConfiguracaoCompraResult | null,
  formData: FormData
): Promise<SalvarConfiguracaoCompraResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const parsed = configuracaoCompraSchema.safeParse({
    unidadeCompraPadrao: formData.get("unidadeCompraPadrao") || undefined,
    unidadeCompraPadraoOutro: formData.get("unidadeCompraPadraoOutro") || undefined,
    fatorConversaoCompraPadrao: formData.get("fatorConversaoCompraPadrao") || undefined,
    loteMinimoCompra: formData.get("loteMinimoCompra") || undefined,
    multiploCompra: formData.get("multiploCompra") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Valor inválido." };
  }
  const { unidadeCompraPadrao, unidadeCompraPadraoOutro, fatorConversaoCompraPadrao, loteMinimoCompra, multiploCompra } =
    parsed.data;

  await prisma.itemGrafica.update({
    where: { id: itemGraficaId },
    data: {
      unidadeCompraPadrao: unidadeCompraPadrao ?? null,
      unidadeCompraPadraoOutro: unidadeCompraPadrao === "OUTRO" ? (unidadeCompraPadraoOutro ?? null) : null,
      fatorConversaoCompraPadrao: fatorConversaoCompraPadrao !== undefined ? fatorConversaoCompraPadrao.toFixed(4) : null,
      loteMinimoCompra: loteMinimoCompra !== undefined ? loteMinimoCompra.toFixed(4) : null,
      multiploCompra: multiploCompra !== undefined ? multiploCompra.toFixed(4) : null,
    },
  });

  revalidatePath(`/catalogo/${itemGraficaId}`);
  return { ok: true, mensagem: "Salvo." };
}

export async function salvarConfiguracaoAcabamento(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const baseCobrancaParsed = baseCobrancaSchema.safeParse(formData.get("baseCobranca"));
  const estagioParsed = estagioSchema.safeParse(formData.get("estagio"));
  if (!baseCobrancaParsed.success || !estagioParsed.success) {
    return { ok: false, mensagem: "Dados de configuração inválidos." };
  }

  const custoSetup = Number(formData.get("custoSetup") || 0);
  const custoMinimo = Number(formData.get("custoMinimo") || 0);
  const custoFerramentalRaw = formData.get("custoFerramental");
  const custoFerramental = custoFerramentalRaw ? Number(custoFerramentalRaw) : null;

  if (!Number.isFinite(custoSetup) || custoSetup < 0) {
    return { ok: false, mensagem: "Custo de setup inválido." };
  }
  if (!Number.isFinite(custoMinimo) || custoMinimo < 0) {
    return { ok: false, mensagem: "Custo mínimo inválido." };
  }
  if (
    custoFerramental !== null &&
    (!Number.isFinite(custoFerramental) || custoFerramental < 0)
  ) {
    return { ok: false, mensagem: "Custo de ferramental inválido." };
  }

  const configAntes = await prisma.configuracaoAcabamento.findUnique({ where: { itemGraficaId } });

  await prisma.configuracaoAcabamento.upsert({
    where: { itemGraficaId },
    update: {
      baseCobranca: baseCobrancaParsed.data,
      estagio: estagioParsed.data,
      custoSetup,
      custoMinimo,
      custoFerramental,
    },
    create: {
      itemGraficaId,
      baseCobranca: baseCobrancaParsed.data,
      estagio: estagioParsed.data,
      custoSetup,
      custoMinimo,
      custoFerramental,
    },
  });

  const antesTextos: string[] = [];
  const depoisTextos: string[] = [];
  const camposAcabamento: { rotulo: string; antes: unknown; depois: unknown }[] = [
    { rotulo: "Custo de setup", antes: configAntes?.custoSetup ?? null, depois: custoSetup },
    { rotulo: "Custo mínimo", antes: configAntes?.custoMinimo ?? null, depois: custoMinimo },
    { rotulo: "Custo de ferramental", antes: configAntes?.custoFerramental ?? null, depois: custoFerramental },
  ];
  for (const { rotulo, antes, depois } of camposAcabamento) {
    const textoAntes = formatarPreco(antes);
    const textoDepois = formatarPreco(depois);
    if (textoAntes !== textoDepois) {
      antesTextos.push(`${rotulo}: ${textoAntes}`);
      depoisTextos.push(`${rotulo}: ${textoDepois}`);
    }
  }
  if (antesTextos.length > 0) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "catalogo.salvar_config_acabamento",
      entidade: "ItemGrafica",
      entidadeId: itemGraficaId,
      descricao: "Configuração de acabamento do item atualizada",
      valorAnterior: antesTextos.join(", "),
      valorNovo: depoisTextos.join(", "),
    });
  }

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  return { ok: true, mensagem: "Configuração salva com sucesso!" };
}

// Liga/configura o motor de clichê de etiqueta pra um produto M2 — mesma
// estrutura de salvarConfiguracaoAcabamento acima. Presença da linha
// (ConfiguracaoClicheEtiqueta) já é o próprio "ligado", sem checkbox extra.
export async function salvarConfiguracaoClicheEtiqueta(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const custoClichePorCm2 = Number(formData.get("custoClichePorCm2"));
  if (!Number.isFinite(custoClichePorCm2) || custoClichePorCm2 < 0) {
    return { ok: false, mensagem: "Custo do clichê inválido." };
  }

  const configAntes = await prisma.configuracaoClicheEtiqueta.findUnique({
    where: { itemGraficaId },
  });

  await prisma.configuracaoClicheEtiqueta.upsert({
    where: { itemGraficaId },
    update: { custoClichePorCm2 },
    create: { itemGraficaId, custoClichePorCm2 },
  });

  const textoAntes = formatarPreco(configAntes?.custoClichePorCm2 ?? null);
  const textoDepois = formatarPreco(custoClichePorCm2);
  if (textoAntes !== textoDepois) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "catalogo.salvar_config_cliche_etiqueta",
      entidade: "ItemGrafica",
      entidadeId: itemGraficaId,
      descricao: "Configuração de clichê de etiqueta do item atualizada",
      valorAnterior: `Custo do clichê: ${textoAntes}`,
      valorNovo: `Custo do clichê: ${textoDepois}`,
    });
  }

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  return { ok: true, mensagem: "Configuração salva com sucesso!" };
}

// Achado A9 da auditoria de abrangência — mesmo padrão de
// salvarConfiguracaoClicheEtiqueta acima (presença da linha = motor ligado).
export async function salvarConfiguracaoEmenda(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const custoPorMetroLinear = Number(formData.get("custoPorMetroLinear"));
  if (!Number.isFinite(custoPorMetroLinear) || custoPorMetroLinear < 0) {
    return { ok: false, mensagem: "Custo da emenda inválido." };
  }
  const sobreposicaoM = Number(formData.get("sobreposicaoM"));
  if (!Number.isFinite(sobreposicaoM) || sobreposicaoM < 0) {
    return { ok: false, mensagem: "Sobreposição inválida." };
  }

  const configAntes = await prisma.configuracaoEmenda.findUnique({
    where: { itemGraficaId },
  });

  await prisma.configuracaoEmenda.upsert({
    where: { itemGraficaId },
    update: { custoPorMetroLinear, sobreposicaoM },
    create: { itemGraficaId, custoPorMetroLinear, sobreposicaoM },
  });

  const textoAntes = configAntes
    ? `${formatarPreco(configAntes.custoPorMetroLinear)}/m linear, sobreposição ${formatarQuantidade(configAntes.sobreposicaoM)}m`
    : "—";
  const textoDepois = `${formatarPreco(custoPorMetroLinear)}/m linear, sobreposição ${formatarQuantidade(sobreposicaoM)}m`;
  if (textoAntes !== textoDepois) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "catalogo.salvar_config_emenda",
      entidade: "ItemGrafica",
      entidadeId: itemGraficaId,
      descricao: "Configuração de emenda de painéis do item atualizada",
      valorAnterior: `Emenda: ${textoAntes}`,
      valorNovo: `Emenda: ${textoDepois}`,
    });
  }

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  return { ok: true, mensagem: "Configuração salva com sucesso!" };
}

export async function salvarFichaTecnica(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
    include: { itemCatalogo: true },
  });
  // Ficha técnica vale tanto pra PRODUTO quanto pra SERVICO (fase "custo
  // real" — ver comentário no schema de FichaTecnicaItem): um acabamento
  // como laminação também pode consumir material próprio (ex: BOPP). Não é
  // constraint de banco, só a checagem de aplicação abaixo.
  if (
    !itemGrafica ||
    (itemGrafica.itemCatalogo.tipo !== "PRODUTO" && itemGrafica.itemCatalogo.tipo !== "SERVICO")
  ) {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const parsedResult = parseJsonArray(
    formData.get("fichaTecnicaJson"),
    fichaTecnicaItemSchema
  );
  if (!parsedResult.ok) {
    return { ok: false, mensagem: parsedResult.mensagem };
  }

  const materiaPrimaIds = [...new Set(parsedResult.data.map((f) => f.materiaPrimaId))];
  const chavesUnicas = new Set(
    parsedResult.data.map((f) => `${f.materiaPrimaId}::${f.varianteId ?? ""}`)
  );
  if (chavesUnicas.size !== parsedResult.data.length) {
    return { ok: false, mensagem: "Matéria-prima (e variante) duplicada na ficha técnica." };
  }

  if (materiaPrimaIds.length > 0) {
    const materiasValidas = await prisma.itemGrafica.findMany({
      where: {
        id: { in: materiaPrimaIds },
        graficaId: usuario.graficaId,
        itemCatalogo: { tipo: "MATERIA_PRIMA" },
      },
      include: { variantes: { where: { ativo: true }, select: { id: true } } },
    });
    if (materiasValidas.length !== materiaPrimaIds.length) {
      return { ok: false, mensagem: "Uma ou mais matérias-primas selecionadas são inválidas." };
    }
    const porId = new Map(materiasValidas.map((m) => [m.id, m]));
    for (const linha of parsedResult.data) {
      const materia = porId.get(linha.materiaPrimaId)!;
      const temVariantes = materia.variantes.length > 0;
      if (temVariantes && (!linha.varianteId || !materia.variantes.some((v) => v.id === linha.varianteId))) {
        return { ok: false, mensagem: "Selecione uma variante válida para cada matéria-prima com variantes." };
      }
      if (!temVariantes && linha.varianteId) {
        return { ok: false, mensagem: "Essa matéria-prima não tem variantes." };
      }
    }
  }

  // Contagem anterior lida antes da transação (que apaga tudo e recria) — a
  // ficha técnica é o que define o custo de material de todo job futuro deste
  // produto, então trocá-la muda preço daqui pra frente. Registra o tamanho
  // da ficha antes/depois; o detalhe linha a linha fica no próprio cadastro.
  const quantidadeAnterior = await prisma.fichaTecnicaItem.count({
    where: { itemGraficaId },
  });

  await prisma.$transaction([
    prisma.fichaTecnicaItem.deleteMany({ where: { itemGraficaId } }),
    prisma.fichaTecnicaItem.createMany({
      data: parsedResult.data.map((f) => ({
        itemGraficaId,
        materiaPrimaId: f.materiaPrimaId,
        varianteId: f.varianteId ?? null,
        quantidadePorUnidade: f.quantidadePorUnidade,
      })),
    }),
  ]);

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "catalogo.salvar_ficha_tecnica",
    entidade: "ItemGrafica",
    entidadeId: itemGraficaId,
    descricao: `Ficha técnica de "${itemGrafica.itemCatalogo.nome}" alterada`,
    valorAnterior: `${quantidadeAnterior} matéria(s)-prima(s)`,
    valorNovo: `${parsedResult.data.length} matéria(s)-prima(s)`,
  });

  revalidatePath(`/catalogo/${itemGraficaId}`);
  return { ok: true, mensagem: "Ficha técnica salva com sucesso!" };
}

export async function salvarTabelaGramatura(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
    include: { itemCatalogo: true },
  });
  if (!itemGrafica || itemGrafica.itemCatalogo.tipo !== "MATERIA_PRIMA") {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const parsedResult = parseJsonArray(formData.get("tabelaJson"), linhaGramaturaSchema);
  if (!parsedResult.ok) {
    return { ok: false, mensagem: parsedResult.mensagem };
  }

  const gramaturas = parsedResult.data.map((l) => l.gramatura);
  if (gramaturas.length !== new Set(gramaturas).size) {
    return { ok: false, mensagem: "Gramatura duplicada na tabela." };
  }

  const tabelaAntes = await prisma.tabelaPrecoPapel.findMany({ where: { itemGraficaId } });

  await prisma.$transaction([
    prisma.tabelaPrecoPapel.deleteMany({ where: { itemGraficaId } }),
    prisma.tabelaPrecoPapel.createMany({
      data: parsedResult.data.map((l) => ({
        itemGraficaId,
        gramatura: l.gramatura,
        precoKg: l.precoKg,
      })),
    }),
  ]);

  // Tabela inteira é substituída a cada save (delete + recreate) — logar
  // faixa a faixa poluiria a tela igual reajuste em lote faria, então o log
  // é um resumo (quantas faixas antes/depois) pra "mudou o preço do papel X"
  // ainda aparecer na trilha sem virar ruído.
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "catalogo.salvar_tabela_gramatura",
    entidade: "ItemGrafica",
    entidadeId: itemGraficaId,
    descricao: `Tabela de preço por gramatura de "${itemGrafica.itemCatalogo.nome}" atualizada`,
    valorAnterior: `${tabelaAntes.length} faixa${tabelaAntes.length !== 1 ? "s" : ""} de gramatura`,
    valorNovo: `${parsedResult.data.length} faixa${parsedResult.data.length !== 1 ? "s" : ""} de gramatura`,
  });

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  revalidatePath("/orcamento");
  return { ok: true, mensagem: "Gramaturas salvas com sucesso!" };
}

export async function salvarVariantesMateriaPrima(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
    include: { itemCatalogo: true, variantes: { where: { ativo: true } } },
  });
  if (!itemGrafica || itemGrafica.itemCatalogo.tipo !== "MATERIA_PRIMA") {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const parsedResult = parseJsonArray(formData.get("variantesJson"), linhaVarianteSchema);
  if (!parsedResult.ok) {
    return { ok: false, mensagem: parsedResult.mensagem };
  }

  const rotulos = parsedResult.data.map((l) => l.rotulo);
  if (rotulos.length !== new Set(rotulos).size) {
    return { ok: false, mensagem: "Rótulo de variante duplicado." };
  }

  const idsExistentes = new Set(itemGrafica.variantes.map((v) => v.id));
  const idsNoPayload = new Set(parsedResult.data.filter((l) => l.id).map((l) => l.id!));
  // Só aceita ids que já pertencem a ESTE item — evita atualizar a variante
  // de outra gráfica/item por id forjado no FormData.
  for (const linha of parsedResult.data) {
    if (linha.id && !idsExistentes.has(linha.id)) {
      return { ok: false, mensagem: "Variante inválida no envio." };
    }
  }

  // Nunca apaga de verdade — uma variante pode já ter ficha técnica ou
  // movimentação de estoque apontando pra ela. O que sumiu do payload só
  // é desativado (some da tela, histórico continua íntegro).
  const idsParaDesativar = [...idsExistentes].filter((id) => !idsNoPayload.has(id));

  const operacoes: Prisma.PrismaPromise<unknown>[] = [];
  if (idsParaDesativar.length > 0) {
    operacoes.push(
      prisma.varianteMateriaPrima.updateMany({
        where: { id: { in: idsParaDesativar }, itemGraficaId },
        data: { ativo: false },
      })
    );
  }

  // Índice de cada updateMany de estoque dentro de `operacoes`, pra depois
  // conferir count === 0 (CAS perdido — alguém baixou estoque em produção
  // enquanto a tela ficava aberta) e avisar sem falhar o salvamento inteiro.
  const indicesEstoqueCas: { indice: number; rotulo: string }[] = [];

  for (const linha of parsedResult.data) {
    const dadosSemEstoque = {
      rotulo: linha.rotulo,
      precoCompra: linha.precoCompra,
      estoqueMinimo: linha.estoqueMinimo ?? null,
      perdaFixaPadrao: linha.perdaFixaPadrao ?? null,
    };
    if (linha.id) {
      operacoes.push(
        prisma.varianteMateriaPrima.updateMany({
          where: { id: linha.id, itemGraficaId },
          data: dadosSemEstoque,
        })
      );
      // Compare-and-swap: só grava o estoqueAtual novo se ele ainda for o
      // mesmo valor que a tela leu quando carregou — senão uma baixa de
      // produção concorrente seria apagada silenciosamente (mesma correção
      // de salvarCatalogo em src/app/catalogo/actions.ts).
      indicesEstoqueCas.push({ indice: operacoes.length, rotulo: linha.rotulo });
      operacoes.push(
        prisma.varianteMateriaPrima.updateMany({
          where: { id: linha.id, itemGraficaId, estoqueAtual: linha.estoqueAtualOriginal ?? null },
          data: { estoqueAtual: linha.estoqueAtual ?? null },
        })
      );
    } else {
      // Variante nova — nada a comparar, ninguém pode ter baixado estoque de
      // uma linha que ainda não existia.
      operacoes.push(
        prisma.varianteMateriaPrima.create({
          data: { itemGraficaId, ativo: true, ...dadosSemEstoque, estoqueAtual: linha.estoqueAtual ?? null },
        })
      );
    }
  }

  const resultados = await prisma.$transaction(operacoes);

  const rotulosEstoqueNaoAtualizado = indicesEstoqueCas
    .filter(({ indice }) => (resultados[indice] as { count: number }).count === 0)
    .map(({ rotulo }) => rotulo);

  // Preço/estoque de variante: mesma lógica de salvarCatalogo (registrar
  // antes/depois de campo que mudou de verdade). estoqueAtual só entra na
  // comparação se o compare-and-swap acima realmente aplicou — senão o
  // valor no banco continua o de antes, e comparar contra o que a tela
  // ENVIOU (não o que foi gravado) geraria um log falso.
  const nomeItem = itemGrafica.itemCatalogo.nome;
  const antesPorId = new Map(itemGrafica.variantes.map((v) => [v.id, v]));

  for (const id of idsParaDesativar) {
    const antes = antesPorId.get(id);
    if (!antes) continue;
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "catalogo.desativar_variante",
      entidade: "VarianteMateriaPrima",
      entidadeId: id,
      descricao: `Variante "${antes.rotulo}" de "${nomeItem}" desativada`,
    });
  }

  for (const linha of parsedResult.data) {
    if (linha.id) {
      const antes = antesPorId.get(linha.id);
      if (!antes) continue;
      const estoqueAplicado = !rotulosEstoqueNaoAtualizado.includes(linha.rotulo);
      const antesTextos: string[] = [];
      const depoisTextos: string[] = [];
      if (antes.rotulo !== linha.rotulo) {
        antesTextos.push(`Rótulo: ${antes.rotulo}`);
        depoisTextos.push(`Rótulo: ${linha.rotulo}`);
      }
      const camposVariante: { rotulo: string; antes: unknown; depois: unknown; formatar: (v: unknown) => string }[] = [
        { rotulo: "Compra", antes: antes.precoCompra, depois: linha.precoCompra, formatar: formatarPreco },
        {
          rotulo: "Estoque atual",
          antes: antes.estoqueAtual,
          depois: estoqueAplicado ? (linha.estoqueAtual ?? null) : antes.estoqueAtual,
          formatar: formatarQuantidade,
        },
        { rotulo: "Estoque mínimo", antes: antes.estoqueMinimo, depois: linha.estoqueMinimo ?? null, formatar: formatarQuantidade },
        { rotulo: "Perda fixa", antes: antes.perdaFixaPadrao, depois: linha.perdaFixaPadrao ?? null, formatar: formatarQuantidade },
      ];
      for (const campo of camposVariante) {
        const textoAntes = campo.formatar(campo.antes);
        const textoDepois = campo.formatar(campo.depois);
        if (textoAntes !== textoDepois) {
          antesTextos.push(`${campo.rotulo}: ${textoAntes}`);
          depoisTextos.push(`${campo.rotulo}: ${textoDepois}`);
        }
      }
      if (antesTextos.length > 0) {
        await registrarAuditoria({
          graficaId: usuario.graficaId,
          usuarioId: usuario.id,
          usuarioNome: usuario.nome,
          acao: "catalogo.editar_variante",
          entidade: "VarianteMateriaPrima",
          entidadeId: linha.id,
          descricao: `Variante "${linha.rotulo}" de "${nomeItem}" atualizada`,
          valorAnterior: antesTextos.join(", "),
          valorNovo: depoisTextos.join(", "),
        });
      }
    } else {
      await registrarAuditoria({
        graficaId: usuario.graficaId,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        acao: "catalogo.criar_variante",
        entidade: "VarianteMateriaPrima",
        entidadeId: itemGraficaId,
        descricao: `Variante "${linha.rotulo}" criada em "${nomeItem}"`,
        valorNovo: `Compra: ${formatarPreco(linha.precoCompra)}, Estoque atual: ${formatarQuantidade(linha.estoqueAtual ?? null)}`,
      });
    }
  }

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  revalidatePath("/producao");
  revalidatePath("/meu-negocio");

  if (rotulosEstoqueNaoAtualizado.length > 0) {
    return {
      ok: true,
      mensagem: `Variantes salvas — mas o estoque de "${rotulosEstoqueNaoAtualizado.join('", "')}" mudou desde que a tela carregou e não foi sobrescrito. Recarregue a página pra conferir o valor atual antes de editar de novo.`,
    };
  }
  return { ok: true, mensagem: "Variantes salvas com sucesso!" };
}

// ─── Movimentação de estoque: histórico + lançamento manual (fase "custo
// real", §4.3) ───────────────────────────────────────────────────────────
//
// Três Server Actions, uma por tipo de lançamento manual — cada uma tem
// campos obrigatórios bem diferentes (custo unitário vs. motivo vs. nova
// contagem), então schemas e validação separados ficam mais claros que um
// parâmetro `tipo` genérico. Todas operam só sobre matéria-prima (é onde
// estoque é controlado hoje — ver teste manual do plano), com ou sem
// variante.

export type LancarMovimentacaoResult = SalvarConfigResult;

// Resolve e valida (tenant + tipo + variante) o alvo de um lançamento manual
// de estoque — mesma dupla checagem de tenant (id + graficaId) das outras
// actions deste arquivo. Devolve null pra qualquer coisa que não bata
// (item de outra gráfica, item que não é matéria-prima, variante que não
// pertence a este item ou já foi desativada).
async function resolverItemMateriaPrima(itemGraficaId: string, varianteId: string | undefined, graficaId: string) {
  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId, itemCatalogo: { tipo: "MATERIA_PRIMA" } },
    include: { itemCatalogo: true, variantes: { where: { ativo: true } } },
  });
  if (!itemGrafica) return null;
  if (varianteId) {
    const variante = itemGrafica.variantes.find((v) => v.id === varianteId);
    if (!variante) return null;
    return { itemGrafica, variante };
  }
  return { itemGrafica, variante: null as (typeof itemGrafica.variantes)[number] | null };
}

const entradaCompraSchema = z.object({
  itemGraficaId: z.string().min(1),
  varianteId: z.string().min(1).optional(),
  quantidade: z.coerce.number().positive("Quantidade deve ser maior que zero."),
  custoUnitario: z.coerce.number().positive("Custo unitário deve ser maior que zero."),
  documento: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : undefined)),
  fornecedorId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

// Entrada de compra: além de registrar a movimentação, atualiza o preço de
// custo cadastrado do material (ou da variante) pro valor informado — é o
// único ponto do sistema onde o preço de custo "envelhecido" se atualiza
// (ver fase-custo-real.md §6, risco "Preço de insumo desatualizado"). Por
// isso é o único dos três lançamentos manuais que gera auditoria: os outros
// dois (saída manual, ajuste de inventário) não tocam em preço, só em
// quantidade.
export async function lancarEntradaCompra(
  _estadoAnterior: LancarMovimentacaoResult | null,
  formData: FormData
): Promise<LancarMovimentacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }

  const parsed = entradaCompraSchema.safeParse({
    itemGraficaId: formData.get("itemGraficaId"),
    varianteId: formData.get("varianteId") || undefined,
    quantidade: formData.get("quantidade"),
    custoUnitario: formData.get("custoUnitario"),
    documento: formData.get("documento") ?? undefined,
    fornecedorId: formData.get("fornecedorId") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const { itemGraficaId, varianteId, quantidade, custoUnitario, documento, fornecedorId } = parsed.data;

  const resolvido = await resolverItemMateriaPrima(itemGraficaId, varianteId, usuario.graficaId);
  if (!resolvido) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  const { itemGrafica, variante } = resolvido;
  const nomeItem = `${itemGrafica.itemCatalogo.nome}${variante ? ` (${variante.rotulo})` : ""}`;

  // Mesma dupla checagem de tenant do restante deste arquivo — fornecedor
  // precisa pertencer à graficaId do usuário, senão o id é ignorado (não
  // falha o lançamento, só não vincula um fornecedor inválido/forjado).
  let fornecedorValidoId: string | null = null;
  if (fornecedorId) {
    const fornecedorValido = await prisma.fornecedor.findFirst({
      where: { id: fornecedorId, graficaId: usuario.graficaId },
      select: { id: true },
    });
    if (!fornecedorValido) {
      return { ok: false, mensagem: "Fornecedor selecionado é inválido." };
    }
    fornecedorValidoId = fornecedorValido.id;
  }

  const precoAnterior = variante ? variante.precoCompra : itemGrafica.precoCompra;
  const estoqueAnterior = variante ? variante.estoqueAtual : itemGrafica.estoqueAtual;

  const quantidadeDec = new D(quantidade);
  const custoUnitarioDec = new D(custoUnitario);
  const custoTotalDec = quantidadeDec.times(custoUnitarioDec);
  const novoEstoque = new D(estoqueAnterior ?? 0).plus(quantidadeDec).toFixed(4);
  const agora = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      // Compare-and-swap: só grava se estoqueAtual ainda for o valor lido
      // acima (ver ErroEstoqueDivergente) — mesmo princípio de
      // salvarCatalogo/salvarVariantesMateriaPrima.
      const cas = variante
        ? await tx.varianteMateriaPrima.updateMany({
            where: { id: variante.id, estoqueAtual: estoqueAnterior },
            data: { estoqueAtual: novoEstoque, precoCompra: custoUnitarioDec.toFixed(4) },
          })
        : await tx.itemGrafica.updateMany({
            where: { id: itemGrafica.id, estoqueAtual: estoqueAnterior },
            data: {
              estoqueAtual: novoEstoque,
              precoCompra: custoUnitarioDec.toFixed(4),
              // Alimenta o aviso de "preço de insumo desatualizado" — ver
              // achado A1-Parte6 da auditoria de abrangência (2026-08-24).
              // Só no branch sem variante: VarianteMateriaPrima não tem esse
              // campo (fora de escopo desta rodada).
              precoCompraAtualizadoEm: agora,
            },
          });
      if (cas.count === 0) {
        throw new ErroEstoqueDivergente();
      }
      await tx.movimentacaoEstoque.create({
        data: {
          itemGraficaId: itemGrafica.id,
          varianteId: variante?.id ?? null,
          tipo: "ENTRADA_COMPRA",
          quantidade: quantidadeDec.toFixed(4),
          custoUnitario: custoUnitarioDec.toFixed(4),
          custoTotal: custoTotalDec.toFixed(2),
          precoReferenciaEm: agora,
          documento: documento ?? null,
          fornecedorId: fornecedorValidoId,
          criadoPorId: usuario.id,
        },
      });
    });
  } catch (erro) {
    if (erro instanceof ErroEstoqueDivergente) {
      return { ok: false, mensagem: MENSAGEM_ESTOQUE_DIVERGENTE };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "catalogo.entrada_compra",
    entidade: variante ? "VarianteMateriaPrima" : "ItemGrafica",
    entidadeId: variante ? variante.id : itemGrafica.id,
    descricao: `Entrada de compra de "${nomeItem}" atualizou o preço de custo cadastrado`,
    valorAnterior: formatarPreco(precoAnterior),
    valorNovo: formatarPreco(custoUnitario),
  });

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");
  return { ok: true, mensagem: "Entrada de compra registrada e preço de custo atualizado." };
}

const saidaManualSchema = z.object({
  itemGraficaId: z.string().min(1),
  varianteId: z.string().min(1).optional(),
  quantidade: z.coerce.number().positive("Quantidade deve ser maior que zero."),
  motivo: z.string().trim().min(1, "Informe o motivo da saída.").max(300),
});

// Saída manual: perda, quebra, uso avulso — qualquer baixa que não veio da
// produção nem é uma correção de contagem. Motivo é obrigatório de
// propósito (ver fase-custo-real.md §4.3): sem ele o histórico vira uma
// lista de números sem explicação.
export async function lancarSaidaManual(
  _estadoAnterior: LancarMovimentacaoResult | null,
  formData: FormData
): Promise<LancarMovimentacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }

  const parsed = saidaManualSchema.safeParse({
    itemGraficaId: formData.get("itemGraficaId"),
    varianteId: formData.get("varianteId") || undefined,
    quantidade: formData.get("quantidade"),
    motivo: formData.get("motivo"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const { itemGraficaId, varianteId, quantidade, motivo } = parsed.data;

  const resolvido = await resolverItemMateriaPrima(itemGraficaId, varianteId, usuario.graficaId);
  if (!resolvido) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  const { itemGrafica, variante } = resolvido;
  const estoqueAnterior = variante ? variante.estoqueAtual : itemGrafica.estoqueAtual;
  const quantidadeDec = new D(quantidade);

  try {
    await prisma.$transaction(async (tx) => {
      // Sem controle de estoque (estoqueAtual null) — grava o histórico da
      // saída mesmo assim, só não mexe num número que não existe (mesmo
      // princípio de "sem controle de estoque" já usado na baixa automática).
      if (estoqueAnterior !== null) {
        const novoEstoque = new D(estoqueAnterior).minus(quantidadeDec).toFixed(4);
        // Compare-and-swap — ver ErroEstoqueDivergente.
        const cas = variante
          ? await tx.varianteMateriaPrima.updateMany({
              where: { id: variante.id, estoqueAtual: estoqueAnterior },
              data: { estoqueAtual: novoEstoque },
            })
          : await tx.itemGrafica.updateMany({
              where: { id: itemGrafica.id, estoqueAtual: estoqueAnterior },
              data: { estoqueAtual: novoEstoque },
            });
        if (cas.count === 0) {
          throw new ErroEstoqueDivergente();
        }
      }
      await tx.movimentacaoEstoque.create({
        data: {
          itemGraficaId: itemGrafica.id,
          varianteId: variante?.id ?? null,
          tipo: "SAIDA_MANUAL",
          quantidade: quantidadeDec.toFixed(4),
          motivo,
          criadoPorId: usuario.id,
        },
      });
    });
  } catch (erro) {
    if (erro instanceof ErroEstoqueDivergente) {
      return { ok: false, mensagem: MENSAGEM_ESTOQUE_DIVERGENTE };
    }
    throw erro;
  }

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");
  return { ok: true, mensagem: "Saída manual registrada." };
}

const ajusteInventarioSchema = z.object({
  itemGraficaId: z.string().min(1),
  varianteId: z.string().min(1).optional(),
  novoEstoque: z.coerce.number().min(0, "Estoque não pode ser negativo."),
  observacao: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

// Ajuste de inventário: contagem física. A TELA manda o novo valor total
// (o que o operador contou no chão de fábrica), não a diferença — é aqui,
// não na tela, que o delta vira a `quantidade` gravada na movimentação (ver
// calcularDeltaAjusteInventario). Mesma lógica reaproveitada por
// catalogo/actions.ts quando "estoque atual" é editado direto no cadastro.
export async function lancarAjusteInventario(
  _estadoAnterior: LancarMovimentacaoResult | null,
  formData: FormData
): Promise<LancarMovimentacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }

  const parsed = ajusteInventarioSchema.safeParse({
    itemGraficaId: formData.get("itemGraficaId"),
    varianteId: formData.get("varianteId") || undefined,
    novoEstoque: formData.get("novoEstoque"),
    observacao: formData.get("observacao") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0].message };
  }
  const { itemGraficaId, varianteId, novoEstoque, observacao } = parsed.data;

  const resolvido = await resolverItemMateriaPrima(itemGraficaId, varianteId, usuario.graficaId);
  if (!resolvido) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  const { itemGrafica, variante } = resolvido;
  const estoqueAnterior = variante ? variante.estoqueAtual : itemGrafica.estoqueAtual;
  const delta = calcularDeltaAjusteInventario(
    estoqueAnterior !== null ? Number(estoqueAnterior) : null,
    novoEstoque
  );

  if (delta === 0) {
    return { ok: false, mensagem: "O novo estoque informado é igual ao atual — nada para ajustar." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Compare-and-swap — ver ErroEstoqueDivergente. Especialmente
      // importante aqui: o "novo estoque" digitado é um valor ABSOLUTO
      // baseado na contagem física que o operador viu quando abriu o form —
      // sem essa checagem, uma baixa de produção concorrente seria
      // sobrescrita pelo valor contado, que já não reflete mais o consumo
      // que aconteceu no meio-tempo.
      const cas = variante
        ? await tx.varianteMateriaPrima.updateMany({
            where: { id: variante.id, estoqueAtual: estoqueAnterior },
            data: { estoqueAtual: novoEstoque },
          })
        : await tx.itemGrafica.updateMany({
            where: { id: itemGrafica.id, estoqueAtual: estoqueAnterior },
            data: { estoqueAtual: novoEstoque },
          });
      if (cas.count === 0) {
        throw new ErroEstoqueDivergente();
      }
      await tx.movimentacaoEstoque.create({
        data: {
          itemGraficaId: itemGrafica.id,
          varianteId: variante?.id ?? null,
          tipo: "AJUSTE_INVENTARIO",
          quantidade: delta,
          motivo: observacao ?? "Ajuste de contagem física",
          criadoPorId: usuario.id,
        },
      });
    });
  } catch (erro) {
    if (erro instanceof ErroEstoqueDivergente) {
      return { ok: false, mensagem: MENSAGEM_ESTOQUE_DIVERGENTE };
    }
    throw erro;
  }

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  revalidatePath("/meu-negocio");
  return { ok: true, mensagem: "Ajuste de inventário registrado." };
}
