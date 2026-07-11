"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { carregarParametrosTenant } from "@/lib/pricing/carregar";
import { D } from "@/lib/pricing/decimal";
import { calcularNovoPreco } from "@/lib/catalogo-reajuste";
import { buscarItensReajustaveis } from "@/lib/catalogo-reajuste-db";
import { reajusteInputSchema } from "./schema";

export type ItemReajustado = {
  itemGraficaId: string;
  nome: string;
  categoria: string;
  precoAtual: string;
  precoNovo: string;
};

export type VisualizarReajusteResult =
  | { ok: true; itens: ItemReajustado[]; percentual: number; categoriaFiltro: string | null }
  | { ok: false; mensagem: string };

// Nunca confia numa lista pré-calculada vinda do cliente — tanto aqui (preview)
// quanto em aplicarReajusteEmLote (apply), o cálculo é sempre refeito do zero
// a partir do banco, os dois recebendo só {percentual, categoriaFiltro}.

export async function visualizarReajuste(
  _estadoAnterior: VisualizarReajusteResult | null,
  formData: FormData
): Promise<VisualizarReajusteResult> {
  const usuario = await exigirUsuarioAutenticado();

  const parsed = reajusteInputSchema.safeParse({
    percentual: formData.get("percentual"),
    categoriaFiltro: formData.get("categoriaFiltro"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { percentual, categoriaFiltro } = parsed.data;

  const [itens, parametros] = await Promise.all([
    buscarItensReajustaveis(usuario.graficaId, categoriaFiltro),
    carregarParametrosTenant(usuario.graficaId),
  ]);

  if (itens.length === 0) {
    return {
      ok: false,
      mensagem: categoriaFiltro
        ? `Nenhum produto com cálculo Simples encontrado na categoria "${categoriaFiltro}".`
        : "Nenhum produto com cálculo Simples encontrado pra reajustar.",
    };
  }

  const incremento = new D(parametros.incrementoArredondamento);
  const itensReajustados: ItemReajustado[] = itens.map((item) => {
    const precoAtual = new D(item.precoVenda!.toString());
    const precoNovo = calcularNovoPreco(precoAtual, percentual, incremento);
    return {
      itemGraficaId: item.id,
      nome: item.itemCatalogo.nome,
      categoria: item.itemCatalogo.categoria,
      precoAtual: precoAtual.toFixed(2),
      precoNovo: precoNovo.toFixed(2),
    };
  });

  return { ok: true, itens: itensReajustados, percentual, categoriaFiltro };
}

export type AplicarReajusteResult =
  | { ok: true; mensagem: string }
  | { ok: false; mensagem: string };

export async function aplicarReajusteEmLote(
  _estadoAnterior: AplicarReajusteResult | null,
  formData: FormData
): Promise<AplicarReajusteResult> {
  const usuario = await exigirUsuarioAutenticado();
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar o catálogo." };
  }

  const parsed = reajusteInputSchema.safeParse({
    percentual: formData.get("percentual"),
    categoriaFiltro: formData.get("categoriaFiltro"),
  });
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { percentual, categoriaFiltro } = parsed.data;

  const [itens, parametros] = await Promise.all([
    buscarItensReajustaveis(usuario.graficaId, categoriaFiltro),
    carregarParametrosTenant(usuario.graficaId),
  ]);

  if (itens.length === 0) {
    return { ok: false, mensagem: "Nenhum produto encontrado pra reajustar." };
  }

  const incremento = new D(parametros.incrementoArredondamento);
  const operacoes = itens.map((item) => {
    const precoAtual = new D(item.precoVenda!.toString());
    const precoNovo = calcularNovoPreco(precoAtual, percentual, incremento);
    return prisma.itemGrafica.update({
      where: { id: item.id },
      data: { precoVenda: precoNovo.toNumber() },
    });
  });

  await prisma.$transaction(operacoes);

  revalidatePath("/catalogo");
  revalidatePath("/orcamento");

  return {
    ok: true,
    mensagem: `Reajuste aplicado em ${itens.length} produto${itens.length > 1 ? "s" : ""}.`,
  };
}
