import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { TipoItemCatalogo, UnidadeMedida } from "@/generated/prisma/enums";
import { parseNumeroBrasileiro } from "./planilha";
// import type: escritores.ts importa a FUNÇÃO deste arquivo — ver comentário
// equivalente em escritor-clientes.ts.
import type { ResultadoEscritaLinha } from "./escritores";

// Diferente de novoItemCatalogoSchema (src/app/catalogo/actions.ts), que
// exige `tipo` e `categoria` porque vem de um formulário com <select> —
// aqui os dois são opcionais e ganham default (PRODUTO / "Importado"), já
// que a maioria das planilhas reais de "lista de produto" não tem essas
// colunas. Exigir aqui derrotaria o motivo da feature existir (ver mesmo
// comentário em campos.ts, CAMPOS_CATALOGO).
export const catalogoImportacaoSchema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto").max(120),
  tipo: z.string().optional(),
  categoria: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : "Importado")),
  descricao: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
  unidade: z.string().optional(),
  precoCompra: z
    .string()
    .optional()
    .transform((v) => (v ? parseNumeroBrasileiro(v) : undefined)),
  precoVenda: z
    .string()
    .optional()
    .transform((v) => (v ? parseNumeroBrasileiro(v) : undefined)),
  estoqueAtual: z
    .string()
    .optional()
    .transform((v) => (v ? parseNumeroBrasileiro(v) : undefined)),
  ncm: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

// Fuzzy-match de texto livre pro enum TipoItemCatalogo — nunca falha
// (planilha sem coluna "tipo", ou com um valor que não bate com nada, cai no
// default PRODUTO, o tipo mais comum numa "lista de produto"). Ordem
// importa: "servi" antes de "materia/prima/insumo" só por clareza, os dois
// grupos não se sobrepõem na prática.
export function normalizarTipoItem(valor: string | undefined): TipoItemCatalogo {
  const texto = valor?.trim().toLowerCase();
  if (!texto) return "PRODUTO";
  if (texto.includes("servi")) return "SERVICO";
  if (texto.includes("materia") || texto.includes("prima") || texto.includes("insumo")) {
    return "MATERIA_PRIMA";
  }
  return "PRODUTO";
}

// \b (limite de palavra) evita que "un" bata dentro de "algum" e que "kg"
// bata dentro de outra abreviação — mas "unidade"/"quilo" por extenso não
// têm "un"/"kg" como token isolado, por isso cada regra testa as duas
// formas.
const REGRAS_UNIDADE: { testa: (v: string) => boolean; unidade: UnidadeMedida }[] = [
  { testa: (v) => /\bm2\b|m²|metro\s*quadrado/.test(v), unidade: "METRO_QUADRADO" },
  { testa: (v) => /\bml\b|metro\s*linear/.test(v), unidade: "METRO_LINEAR" },
  { testa: (v) => /\bun\b|unidade/.test(v), unidade: "UNIDADE" },
  { testa: (v) => /\bkg\b|quilo/.test(v), unidade: "KG" },
  { testa: (v) => /folha/.test(v), unidade: "FOLHA" },
  { testa: (v) => /rolo/.test(v), unidade: "ROLO" },
  { testa: (v) => /pacote/.test(v), unidade: "PACOTE" },
  { testa: (v) => /cento/.test(v), unidade: "CENTO" },
  { testa: (v) => /milheiro/.test(v), unidade: "MILHEIRO" },
  { testa: (v) => /litro/.test(v), unidade: "LITRO" },
  { testa: (v) => /hora/.test(v), unidade: "HORA" },
];

// Vazio/ausente -> undefined (não força unidade nenhuma). Texto que não bate
// com nenhuma regra conhecida -> OUTRO + o texto original truncado (mesmo
// padrão de unidadeOutro em src/app/catalogo/actions.ts), nunca falha.
export function normalizarUnidade(
  valor: string | undefined
): { unidade: UnidadeMedida | undefined; unidadeOutro: string | undefined } {
  const texto = valor?.trim();
  if (!texto) return { unidade: undefined, unidadeOutro: undefined };
  const minusculo = texto.toLowerCase();
  const regra = REGRAS_UNIDADE.find((r) => r.testa(minusculo));
  if (regra) return { unidade: regra.unidade, unidadeOutro: undefined };
  return { unidade: "OUTRO", unidadeOutro: texto.slice(0, 40) };
}

export async function escreverLinhaCatalogo(
  tx: Prisma.TransactionClient,
  graficaId: string,
  linha: Record<string, string>
): Promise<ResultadoEscritaLinha> {
  const parsed = catalogoImportacaoSchema.safeParse(linha);
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { nome, categoria, descricao, precoCompra, precoVenda, estoqueAtual, ncm } = parsed.data;
  const tipo = normalizarTipoItem(parsed.data.tipo);
  const { unidade, unidadeOutro } = normalizarUnidade(parsed.data.unidade);

  let novoItem: { id: string };
  try {
    novoItem = await tx.itemCatalogo.create({
      data: { graficaId, tipo, nome, categoria, descricao, unidade, unidadeOutro, ncm },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: `Já existe um item "${nome}" nesse tipo de catálogo.` };
    }
    throw erro;
  }

  // modeloCalculo fica no default do schema (SIMPLES) — de propósito, ver
  // instrução do plano: motor avançado (M2/OFFSET) é sempre opt-in manual,
  // nunca inferido de planilha.
  await tx.itemGrafica.create({
    data: { graficaId, itemCatalogoId: novoItem.id, precoCompra, precoVenda, estoqueAtual },
  });

  return { ok: true };
}
