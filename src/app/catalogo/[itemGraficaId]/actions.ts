"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { parseJsonArray } from "@/lib/form-json";

export type SalvarConfigResult = { ok: boolean; mensagem: string };

const modeloCalculoSchema = z.enum(["SIMPLES", "M2", "OFFSET"]);
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
  quantidadePorUnidade: z.coerce
    .number()
    .positive("Quantidade por unidade deve ser maior que zero."),
});

export async function salvarModeloProduto(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
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

  try {
    if (modeloCalculo === "SIMPLES") {
      await prisma.itemGrafica.update({
        where: { id: itemGraficaId },
        data: { modeloCalculo: "SIMPLES" },
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
          data: { modeloCalculo: "M2", custoImpressaoM2, areaMinimaFaturavel },
        }),
        prisma.bobinaMaterial.deleteMany({ where: { itemGraficaId } }),
        prisma.bobinaMaterial.createMany({
          data: bobinasResult.data.map((b) => ({ itemGraficaId, ...b })),
        }),
      ]);
    } else {
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
      const precoPorKg = Number(formData.get("precoPorKg") || 0);
      if (!Number.isFinite(gramaturaGm2) || gramaturaGm2 < 30 || gramaturaGm2 > 500) {
        return { ok: false, mensagem: "Gramatura deve estar entre 30 e 500 g/m²." };
      }
      if (!Number.isFinite(precoPorKg) || precoPorKg <= 0) {
        return { ok: false, mensagem: "Informe um preço por kg maior que zero." };
      }

      await prisma.$transaction([
        prisma.itemGrafica.update({
          where: { id: itemGraficaId },
          data: { modeloCalculo: "OFFSET", viraFolha, gramaturaGm2, precoPorKg },
        }),
        prisma.formatoFolha.deleteMany({ where: { itemGraficaId } }),
        prisma.formatoFolha.createMany({
          data: formatosResult.data.map((f) => ({ itemGraficaId, ...f })),
        }),
      ]);
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

export async function salvarConfiguracaoAcabamento(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
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

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  return { ok: true, mensagem: "Configuração salva com sucesso!" };
}

export async function salvarFichaTecnica(
  _estadoAnterior: SalvarConfigResult | null,
  formData: FormData
): Promise<SalvarConfigResult> {
  const usuario = await exigirUsuarioAutenticado();
  const itemGraficaId = String(formData.get("itemGraficaId"));

  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { id: itemGraficaId, graficaId: usuario.graficaId },
    include: { itemCatalogo: true },
  });
  if (!itemGrafica || itemGrafica.itemCatalogo.tipo !== "PRODUTO") {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const parsedResult = parseJsonArray(
    formData.get("fichaTecnicaJson"),
    fichaTecnicaItemSchema
  );
  if (!parsedResult.ok) {
    return { ok: false, mensagem: parsedResult.mensagem };
  }

  const materiaPrimaIds = parsedResult.data.map((f) => f.materiaPrimaId);
  if (materiaPrimaIds.length !== new Set(materiaPrimaIds).size) {
    return { ok: false, mensagem: "Matéria-prima duplicada na ficha técnica." };
  }

  if (materiaPrimaIds.length > 0) {
    const materiasValidas = await prisma.itemGrafica.findMany({
      where: {
        id: { in: materiaPrimaIds },
        graficaId: usuario.graficaId,
        itemCatalogo: { tipo: "MATERIA_PRIMA" },
      },
      select: { id: true },
    });
    if (materiasValidas.length !== materiaPrimaIds.length) {
      return { ok: false, mensagem: "Uma ou mais matérias-primas selecionadas são inválidas." };
    }
  }

  await prisma.$transaction([
    prisma.fichaTecnicaItem.deleteMany({ where: { itemGraficaId } }),
    prisma.fichaTecnicaItem.createMany({
      data: parsedResult.data.map((f) => ({
        itemGraficaId,
        materiaPrimaId: f.materiaPrimaId,
        quantidadePorUnidade: f.quantidadePorUnidade,
      })),
    }),
  ]);

  revalidatePath(`/catalogo/${itemGraficaId}`);
  return { ok: true, mensagem: "Ficha técnica salva com sucesso!" };
}
