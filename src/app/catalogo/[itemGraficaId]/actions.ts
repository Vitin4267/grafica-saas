"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
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
  estoqueMinimo: z.coerce.number().min(0, "Estoque mínimo não pode ser negativo.").optional(),
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
          data: { modeloCalculo: "OFFSET", viraFolha, gramaturaGm2, prensaId, papelId },
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

  // itemCatalogoId pode ser um item mestre (graficaId=null, compartilhado
  // entre todas as gráficas) ou privado dessa gráfica — em ambos os casos,
  // só é acessível daqui se a gráfica atual realmente tem um ItemGrafica
  // apontando pra ele (evita editar NCM de item de outro tenant por id
  // forjado, mesmo sabendo que itens mestre já são compartilhados por design).
  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: { itemCatalogoId, graficaId: usuario.graficaId },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Item não encontrado." };
  }

  const ncm = String(formData.get("ncm") ?? "").trim();

  await prisma.itemCatalogo.update({
    where: { id: itemCatalogoId },
    data: { ncm: ncm || null },
  });

  revalidatePath(`/catalogo/${itemGrafica.id}`);
  revalidatePath("/catalogo");
  return { ok: true, mensagem: "NCM salvo com sucesso!" };
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

  await prisma.$transaction([
    ...(idsParaDesativar.length > 0
      ? [prisma.varianteMateriaPrima.updateMany({ where: { id: { in: idsParaDesativar } }, data: { ativo: false } })]
      : []),
    ...parsedResult.data.map((linha) => {
      const dados = {
        rotulo: linha.rotulo,
        precoCompra: linha.precoCompra,
        estoqueAtual: linha.estoqueAtual ?? null,
        estoqueMinimo: linha.estoqueMinimo ?? null,
      };
      if (linha.id) {
        return prisma.varianteMateriaPrima.update({ where: { id: linha.id }, data: dados });
      }
      return prisma.varianteMateriaPrima.create({ data: { itemGraficaId, ativo: true, ...dados } });
    }),
  ]);

  revalidatePath(`/catalogo/${itemGraficaId}`);
  revalidatePath("/catalogo");
  revalidatePath("/producao");
  revalidatePath("/meu-negocio");
  return { ok: true, mensagem: "Variantes salvas com sucesso!" };
}
