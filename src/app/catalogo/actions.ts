"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { parseJsonArray } from "@/lib/form-json";

export type SalvarCatalogoResult = {
  ok: boolean;
  mensagem: string;
};

const TIPOS_ITEM_CATALOGO = ["PRODUTO", "MATERIA_PRIMA", "SERVICO"] as const;
const UNIDADES_MEDIDA = [
  "FOLHA",
  "METRO_QUADRADO",
  "METRO_LINEAR",
  "UNIDADE",
  "LITRO",
  "KG",
  "ROLO",
  "PACOTE",
  "CENTO",
  "HORA",
] as const;

const novoItemCatalogoSchema = z.object({
  tipo: z.enum(TIPOS_ITEM_CATALOGO),
  nome: z.string().trim().min(2, "Nome muito curto").max(120),
  categoria: z.string().trim().min(2, "Categoria muito curta").max(80),
  descricao: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
  unidade: z
    .union([z.enum(UNIDADES_MEDIDA), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  ncm: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type CriarItemCatalogoResult = {
  ok: boolean;
  mensagem: string;
  itemId?: string;
};

// Cria um item novo PRIVADO da gráfica do usuário (graficaId preenchido — ver
// comentário do model ItemCatalogo no schema). Existe pra cobrir o caso de faltar
// algo no catálogo mestre: o item criado aqui tem exatamente os mesmos campos
// dos itens pré-existentes, então passa a se comportar como um deles em tudo
// (aparece no catálogo, pode ser selecionado e precificado normalmente) — mas só
// para essa gráfica; nenhuma outra gráfica do SaaS o vê.
export async function criarItemCatalogo(
  _estadoAnterior: CriarItemCatalogoResult | null,
  formData: FormData
): Promise<CriarItemCatalogoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }

  const resultado = novoItemCatalogoSchema.safeParse({
    tipo: formData.get("tipo"),
    nome: formData.get("nome"),
    categoria: formData.get("categoria"),
    // FormData.get retorna null (não undefined) pra campos ausentes — o campo
    // "unidade", por exemplo, nem existe no form quando tipo=PRODUTO — e
    // z.optional() só trata undefined como ausente, não null.
    descricao: formData.get("descricao") ?? undefined,
    unidade: formData.get("unidade") ?? undefined,
    ncm: formData.get("ncm") ?? undefined,
  });

  if (!resultado.success) {
    return { ok: false, mensagem: resultado.error.issues[0].message };
  }

  const { tipo, nome, categoria, descricao, unidade, ncm } = resultado.data;

  // Bloqueia duplicar tanto um item já existente no mestre global quanto um item
  // privado que essa mesma gráfica já tenha criado antes. Esse findFirst é só um
  // atalho pra devolver a mensagem rápido no caso comum — quem garante mesmo
  // contra duplicata é a constraint única [graficaId, tipo, nome] no banco (essa
  // action sempre grava com graficaId concreto, nunca null, então a constraint
  // funciona normalmente aqui — ver comentário no schema sobre o caso null),
  // pego abaixo pelo catch em P2002 se dois envios concorrentes passarem os
  // dois pelo findFirst antes de qualquer create commitar.
  const existente = await prisma.itemCatalogo.findFirst({
    where: {
      tipo,
      nome,
      OR: [{ graficaId: null }, { graficaId: usuario.graficaId }],
    },
  });
  if (existente) {
    return { ok: false, mensagem: "Já existe um item com esse nome nesse tipo de catálogo." };
  }

  let novoItem: { id: string };
  try {
    novoItem = await prisma.itemCatalogo.create({
      data: { graficaId: usuario.graficaId, tipo, nome, categoria, descricao, unidade, ncm },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um item com esse nome nesse tipo de catálogo." };
    }
    throw erro;
  }

  revalidatePath("/catalogo");
  revalidatePath("/orcamento");

  return { ok: true, mensagem: `"${nome}" adicionado ao catálogo.`, itemId: novoItem.id };
}

// Devolve null pra campo vazio/ausente (legítimo: nem todo item tem preço ou
// controle de estoque) e `false` pra valor inválido — que o chamador rejeita
// com mensagem, em vez de gravar.
//
// O `>= 0` entrou em 2026-07-26: antes só checava finitude, e um preço de
// COMPRA negativo era gravado sem reclamar. Isso não era só um número feio:
// com a gráfica configurada em comissaoVendedorBase=LUCRO, o cálculo faz
// `total - custo` (src/lib/comissao.ts) — subtrair um custo negativo inflava
// a base da comissão do próprio vendedor que editou o catálogo, e essa
// comissão vira Despesa real ao ser marcada como paga. Preço de VENDA
// negativo, no modelo SIMPLES, também passava direto pro total do orçamento
// (M2/OFFSET já rejeitavam). A variante nova logo abaixo (linhaVarianteNovaSchema)
// já validava certo — este caminho "flat" é que estava fora do padrão.
function numeroOuNulo(valor: FormDataEntryValue | null): number | null | false {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return false;
  return n;
}

const linhaVarianteNovaSchema = z.object({
  rotulo: z.string().trim().min(1, "Informe um rótulo pra variante.").max(40),
  precoCompra: z.coerce.number().positive("Preço de compra deve ser maior que zero."),
  estoqueAtual: z.coerce.number().min(0, "Estoque atual não pode ser negativo.").optional(),
  estoqueMinimo: z.coerce.number().min(0, "Estoque mínimo não pode ser negativo.").optional(),
  perdaFixaPadrao: z.coerce.number().min(0, "Perda fixa não pode ser negativa.").optional(),
});

export async function salvarCatalogo(
  _estadoAnterior: SalvarCatalogoResult | null,
  formData: FormData
): Promise<SalvarCatalogoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }

  // Só itens visíveis pra essa gráfica (mestre global + privados dela) — sem esse
  // filtro, um POST forjado poderia marcar o id de um item privado de OUTRA
  // gráfica e criar um ItemGrafica apontando pra ele.
  const itensCatalogo = await prisma.itemCatalogo.findMany({
    where: { OR: [{ graficaId: null }, { graficaId: usuario.graficaId }] },
    select: { id: true, nome: true },
  });

  // Item de matéria-prima com variante ativa não usa mais o preço/estoque
  // "flat" — isso mora nas variantes. A tela nem manda esses campos pra
  // esses itens, mas por segurança ignoramos aqui também (nunca zera preço/
  // estoque de um item que já tem variante só porque o campo veio vazio).
  const itensComVariante = await prisma.itemGrafica.findMany({
    where: { graficaId: usuario.graficaId, variantes: { some: { ativo: true } } },
    select: { itemCatalogoId: true },
  });
  const idsComVariante = new Set(itensComVariante.map((i) => i.itemCatalogoId));

  // Variantes cadastradas inline no próprio catálogo (item ainda não salvo,
  // ver VariantesInlineEditor em CatalogoForm.tsx) — deixa configurar sem
  // precisar salvar o catálogo primeiro e só depois abrir "Gerenciar
  // variantes". Valida tudo ANTES de montar as operações, mesmo padrão de
  // "salva tudo de uma vez, sem operação parcial" usado no resto do app.
  const variantesNovasPorItem = new Map<
    string,
    {
      rotulo: string;
      precoCompra: number;
      estoqueAtual?: number;
      estoqueMinimo?: number;
      perdaFixaPadrao?: number;
    }[]
  >();
  for (const item of itensCatalogo) {
    const raw = formData.get(`variantesNovas_${item.id}`);
    if (!raw) continue;
    const parsedResult = parseJsonArray(raw, linhaVarianteNovaSchema);
    if (!parsedResult.ok) {
      return { ok: false, mensagem: parsedResult.mensagem };
    }
    if (parsedResult.data.length === 0) continue;
    const rotulos = parsedResult.data.map((l) => l.rotulo);
    if (rotulos.length !== new Set(rotulos).size) {
      return { ok: false, mensagem: "Rótulo de variante duplicado." };
    }
    variantesNovasPorItem.set(item.id, parsedResult.data);
  }

  // Mesmo princípio do bloco acima: valida os campos numéricos "flat"
  // (preço/estoque) de TODOS os itens antes de montar qualquer operação, pra
  // nunca gravar um catálogo pela metade. Ver numeroOuNulo pro motivo de
  // rejeitar negativo (comissão inflada via base LUCRO).
  const CAMPOS_NUMERICOS = [
    "compra",
    "venda",
    "estoqueAtual",
    "estoqueMinimo",
    "perdaFixaPadrao",
  ] as const;
  const ROTULO_CAMPO: Record<(typeof CAMPOS_NUMERICOS)[number], string> = {
    compra: "preço de compra",
    venda: "preço de venda",
    estoqueAtual: "estoque atual",
    estoqueMinimo: "estoque mínimo",
    perdaFixaPadrao: "perda fixa de calibragem",
  };
  const numericosPorItem = new Map<string, Record<string, number | null>>();
  for (const item of itensCatalogo) {
    if (formData.get(`sel_${item.id}`) !== "on") continue;
    const valores: Record<string, number | null> = {};
    for (const campo of CAMPOS_NUMERICOS) {
      const valor = numeroOuNulo(formData.get(`${campo}_${item.id}`));
      if (valor === false) {
        return {
          ok: false,
          mensagem: `Valor inválido em "${ROTULO_CAMPO[campo]}" de ${item.nome} — não pode ser negativo.`,
        };
      }
      valores[campo] = valor;
    }
    numericosPorItem.set(item.id, valores);
  }

  const operacoes = itensCatalogo.map((item) => {
    const selecionado = formData.get(`sel_${item.id}`) === "on";

    if (!selecionado) {
      return prisma.itemGrafica.updateMany({
        where: { graficaId: usuario.graficaId, itemCatalogoId: item.id },
        data: { ativo: false },
      });
    }

    if (idsComVariante.has(item.id)) {
      return prisma.itemGrafica.update({
        where: { graficaId_itemCatalogoId: { graficaId: usuario.graficaId, itemCatalogoId: item.id } },
        data: { ativo: true },
      });
    }

    const variantesNovas = variantesNovasPorItem.get(item.id);
    if (variantesNovas) {
      const dadosVariantes = variantesNovas.map((v) => ({
        rotulo: v.rotulo,
        precoCompra: v.precoCompra,
        estoqueAtual: v.estoqueAtual ?? null,
        estoqueMinimo: v.estoqueMinimo ?? null,
        perdaFixaPadrao: v.perdaFixaPadrao ?? null,
      }));
      return prisma.itemGrafica.upsert({
        where: {
          graficaId_itemCatalogoId: { graficaId: usuario.graficaId, itemCatalogoId: item.id },
        },
        update: { ativo: true, variantes: { create: dadosVariantes } },
        create: {
          graficaId: usuario.graficaId,
          itemCatalogoId: item.id,
          ativo: true,
          variantes: { createMany: { data: dadosVariantes } },
        },
      });
    }

    const numericos = numericosPorItem.get(item.id) ?? {};
    const dados = {
      ativo: true,
      precoCompra: numericos.compra ?? null,
      precoVenda: numericos.venda ?? null,
      estoqueAtual: numericos.estoqueAtual ?? null,
      estoqueMinimo: numericos.estoqueMinimo ?? null,
      perdaFixaPadrao: numericos.perdaFixaPadrao ?? null,
    };

    return prisma.itemGrafica.upsert({
      where: {
        graficaId_itemCatalogoId: {
          graficaId: usuario.graficaId,
          itemCatalogoId: item.id,
        },
      },
      update: dados,
      create: { graficaId: usuario.graficaId, itemCatalogoId: item.id, ...dados },
    });
  });

  await prisma.$transaction(operacoes);

  revalidatePath("/catalogo");
  revalidatePath("/orcamento");

  return { ok: true, mensagem: "Catálogo atualizado com sucesso!" };
}
