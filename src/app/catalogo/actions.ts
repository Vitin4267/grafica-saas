"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";

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

  const resultado = novoItemCatalogoSchema.safeParse({
    tipo: formData.get("tipo"),
    nome: formData.get("nome"),
    categoria: formData.get("categoria"),
    // FormData.get retorna null (não undefined) pra campos ausentes — o campo
    // "unidade", por exemplo, nem existe no form quando tipo=PRODUTO — e
    // z.optional() só trata undefined como ausente, não null.
    descricao: formData.get("descricao") ?? undefined,
    unidade: formData.get("unidade") ?? undefined,
  });

  if (!resultado.success) {
    return { ok: false, mensagem: resultado.error.issues[0].message };
  }

  const { tipo, nome, categoria, descricao, unidade } = resultado.data;

  // Bloqueia duplicar tanto um item já existente no mestre global quanto um item
  // privado que essa mesma gráfica já tenha criado antes.
  // TODO(review): findFirst + create não são atômicos (TOCTOU) — duplo clique/
  // duplo submit com o mesmo tipo+nome pode passar pelos dois nesse findFirst
  // antes de qualquer create commitar, resultando em dois itens de catálogo
  // idênticos pra mesma gráfica. A constraint única [graficaId, tipo, nome] no
  // schema pegaria isso a nível de banco (retornando erro em vez de duplicar) —
  // vale envolver o create num try/catch tratando o erro de unique constraint.
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

  const novoItem = await prisma.itemCatalogo.create({
    data: { graficaId: usuario.graficaId, tipo, nome, categoria, descricao, unidade },
  });

  revalidatePath("/catalogo");
  revalidatePath("/orcamento");

  return { ok: true, mensagem: `"${nome}" adicionado ao catálogo.`, itemId: novoItem.id };
}

function numeroOuNulo(valor: FormDataEntryValue | null): number | null {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export async function salvarCatalogo(
  _estadoAnterior: SalvarCatalogoResult | null,
  formData: FormData
): Promise<SalvarCatalogoResult> {
  const usuario = await exigirUsuarioAutenticado();

  // Só itens visíveis pra essa gráfica (mestre global + privados dela) — sem esse
  // filtro, um POST forjado poderia marcar o id de um item privado de OUTRA
  // gráfica e criar um ItemGrafica apontando pra ele.
  const itensCatalogo = await prisma.itemCatalogo.findMany({
    where: { OR: [{ graficaId: null }, { graficaId: usuario.graficaId }] },
    select: { id: true },
  });

  const operacoes = itensCatalogo.map((item) => {
    const selecionado = formData.get(`sel_${item.id}`) === "on";

    if (!selecionado) {
      return prisma.itemGrafica.updateMany({
        where: { graficaId: usuario.graficaId, itemCatalogoId: item.id },
        data: { ativo: false },
      });
    }

    const dados = {
      ativo: true,
      precoCompra: numeroOuNulo(formData.get(`compra_${item.id}`)),
      precoVenda: numeroOuNulo(formData.get(`venda_${item.id}`)),
      estoqueAtual: numeroOuNulo(formData.get(`estoqueAtual_${item.id}`)),
      estoqueMinimo: numeroOuNulo(formData.get(`estoqueMinimo_${item.id}`)),
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
