"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { parseJsonArray } from "@/lib/form-json";
import { registrarAuditoria } from "@/lib/auditoria";
import { formatoMoeda } from "@/lib/moeda";
import { calcularDeltaAjusteInventario } from "@/lib/estoque-manual";

const formatoQuantidade = new Intl.NumberFormat("pt-BR");

function formatarPreco(valor: unknown): string {
  return valor === null || valor === undefined ? "—" : formatoMoeda.format(Number(valor));
}

function formatarQuantidade(valor: unknown): string {
  return valor === null || valor === undefined ? "—" : formatoQuantidade.format(Number(valor));
}

export type SalvarCatalogoResult = {
  ok: boolean;
  mensagem: string;
};

const TIPOS_ITEM_CATALOGO = ["PRODUTO", "MATERIA_PRIMA", "SERVICO"] as const;
// Espelha o enum UnidadeMedida do schema (ver node_modules/.../generated —
// MILHEIRO estava faltando aqui antes de OUTRO entrar, então uma gráfica que
// escolhesse "milheiro" no <Select> — que lista TODO ROTULO_UNIDADE — levava
// um erro de validação silencioso; corrigido junto com a adição de OUTRO).
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
  "MILHEIRO",
  "HORA",
  "OUTRO",
] as const;

const novoItemCatalogoSchema = z
  .object({
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
    // Texto livre pra unidade=OUTRO (ex: "resma", "galão", "fardo") — mesmo
    // espírito de materialSubstratoOutro em src/lib/orcamento-etiqueta.ts.
    unidadeOutro: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v ? v : undefined)),
    ncm: z
      .string()
      .trim()
      .max(20)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((dados) => dados.unidade !== "OUTRO" || Boolean(dados.unidadeOutro), {
    message: 'Descreva a unidade quando escolher "Outro".',
    path: ["unidadeOutro"],
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
    unidadeOutro: formData.get("unidadeOutro") ?? undefined,
    ncm: formData.get("ncm") ?? undefined,
  });

  if (!resultado.success) {
    return { ok: false, mensagem: resultado.error.issues[0].message };
  }

  const { tipo, nome, categoria, descricao, unidade, unidadeOutro, ncm } = resultado.data;

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

  // Só grava unidadeOutro quando a unidade escolhida de fato for OUTRO — evita
  // um texto órfão sobrando no banco se o formulário mandar os dois campos
  // (ex: usuário digitou algo, depois trocou pra uma unidade da lista fechada).
  const unidadeOutroFinal = unidade === "OUTRO" ? unidadeOutro : undefined;

  let novoItem: { id: string };
  try {
    novoItem = await prisma.itemCatalogo.create({
      data: {
        graficaId: usuario.graficaId,
        tipo,
        nome,
        categoria,
        descricao,
        unidade,
        unidadeOutro: unidadeOutroFinal,
        ncm,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um item com esse nome nesse tipo de catálogo." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "catalogo.criar_item",
    entidade: "ItemCatalogo",
    entidadeId: novoItem.id,
    descricao: `Item "${nome}" (${categoria}) criado no catálogo`,
  });

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

// Lê o valor de estoqueAtual que a TELA tinha quando carregou (campo oculto
// estoqueAtualOriginal_, ver CatalogoForm.tsx) — usado só pra COMPARAR
// (compare-and-swap) antes de sobrescrever estoqueAtual, nunca pra validar
// nem gravar diretamente. Qualquer coisa que não dê pra interpretar vira
// null ("sem baseline confiável"), o que só faz o CAS abaixo falhar com
// segurança (pula esse campo específico) em vez de travar o resto do
// salvamento — diferente de numeroOuNulo, nunca retorna `false`.
function numeroOriginalOuNulo(valor: FormDataEntryValue | null): number | null {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
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
  //
  // A mesma consulta também dá idsComItemGrafica: quais itens JÁ TÊM uma
  // linha em ItemGrafica pra esta gráfica — usado pelo compare-and-swap do
  // estoque mais abaixo (só existe um valor "antigo" pra proteger quando a
  // linha já existia antes deste salvamento; linha nova não tem concorrência
  // possível, porque nada em produção pode ter baixado um estoque que ainda
  // nem existia).
  // Campos de preço/estoque incluídos aqui (além de itemCatalogoId/variantes,
  // já usados pelos sets abaixo) só pra servir de "antes" na auditoria de
  // preço/estoque montada depois que a transação principal gravar — ver
  // comentário perto de `resultados` mais abaixo.
  const itensGraficaAtuais = await prisma.itemGrafica.findMany({
    where: { graficaId: usuario.graficaId },
    select: {
      id: true,
      itemCatalogoId: true,
      precoCompra: true,
      precoVenda: true,
      estoqueAtual: true,
      estoqueMinimo: true,
      perdaFixaPadrao: true,
      variantes: { where: { ativo: true }, select: { id: true } },
    },
  });
  const idsComVariante = new Set(
    itensGraficaAtuais.filter((i) => i.variantes.length > 0).map((i) => i.itemCatalogoId)
  );
  const idsComItemGrafica = new Set(itensGraficaAtuais.map((i) => i.itemCatalogoId));
  const antesPorItemCatalogoId = new Map(itensGraficaAtuais.map((i) => [i.itemCatalogoId, i]));

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

  // Construído com push (em vez de itensCatalogo.map) porque um item
  // existente pode virar DUAS operações agora: os campos "normais" (sempre
  // gravados) e, à parte, o compare-and-swap do estoque atual (só grava se
  // ninguém mexeu nele desde que a tela carregou — ver comentário mais
  // abaixo). casPendentes guarda em que posição de `operacoes` cada CAS de
  // estoque caiu, pra conferir o resultado depois que a transação roda e
  // avisar o usuário se algum ficou de fora.
  const operacoes: Prisma.PrismaPromise<unknown>[] = [];
  // itemGraficaId/original/novo guardados aqui pra, depois que a transação
  // rodar, gerar a MovimentacaoEstoque de AJUSTE_INVENTARIO só pros CAS que
  // de fato aplicaram (ver bloco depois de `resultados` mais abaixo) — sem
  // isso, editar "estoque atual" aqui sobrescrevia o número sem deixar
  // rastro (ver fase-custo-real.md §4.3).
  const casPendentes: { nome: string; opIndex: number; itemGraficaId: string; original: number | null; novo: number | null }[] = [];

  for (const item of itensCatalogo) {
    const selecionado = formData.get(`sel_${item.id}`) === "on";

    if (!selecionado) {
      operacoes.push(
        prisma.itemGrafica.updateMany({
          where: { graficaId: usuario.graficaId, itemCatalogoId: item.id },
          data: { ativo: false },
        })
      );
      continue;
    }

    if (idsComVariante.has(item.id)) {
      operacoes.push(
        prisma.itemGrafica.update({
          where: { graficaId_itemCatalogoId: { graficaId: usuario.graficaId, itemCatalogoId: item.id } },
          data: { ativo: true },
        })
      );
      continue;
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
      operacoes.push(
        prisma.itemGrafica.upsert({
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
        })
      );
      continue;
    }

    const numericos = numericosPorItem.get(item.id) ?? {};
    // estoqueAtual sai do conjunto "normal" de propósito — quem grava ele é
    // o bloco de compare-and-swap logo abaixo. Preço e estoque mínimo
    // continuam sobrescrevendo direto: só o estoque ATUAL sofre baixa
    // automática durante a produção (ver status-transicao.ts), então só ele
    // corre risco de ficar obsoleto entre a tela abrir e o usuário salvar.
    const dadosSemEstoqueAtual = {
      ativo: true,
      precoCompra: numericos.compra ?? null,
      precoVenda: numericos.venda ?? null,
      estoqueMinimo: numericos.estoqueMinimo ?? null,
      perdaFixaPadrao: numericos.perdaFixaPadrao ?? null,
    };
    const novoEstoqueAtual = numericos.estoqueAtual ?? null;

    if (!idsComItemGrafica.has(item.id)) {
      // Linha nova pra esta gráfica: sem valor concorrente pra proteger,
      // grava o estoque direto junto com o resto.
      operacoes.push(
        prisma.itemGrafica.upsert({
          where: {
            graficaId_itemCatalogoId: { graficaId: usuario.graficaId, itemCatalogoId: item.id },
          },
          update: dadosSemEstoqueAtual,
          create: {
            graficaId: usuario.graficaId,
            itemCatalogoId: item.id,
            ...dadosSemEstoqueAtual,
            estoqueAtual: novoEstoqueAtual,
          },
        })
      );
      continue;
    }

    // Linha já existia: os demais campos sempre gravam — o usuário pode ter
    // só mexido no preço de OUTRO item e mandado de volta o resto igual.
    operacoes.push(
      prisma.itemGrafica.update({
        where: { graficaId_itemCatalogoId: { graficaId: usuario.graficaId, itemCatalogoId: item.id } },
        data: dadosSemEstoqueAtual,
      })
    );

    // Compare-and-swap: só sobrescreve estoqueAtual se ele ainda for igual
    // ao valor que a TELA leu quando a página abriu (estoqueAtualOriginal_,
    // ver CatalogoForm.tsx). Se uma produção baixou esse estoque enquanto a
    // aba ficava aberta, o valor no banco já não bate mais com o original —
    // o updateMany abaixo então casa zero linhas (o WHERE não encontra
    // nada) e o campo simplesmente não é tocado, em vez de apagar a baixa
    // que aconteceu no meio-tempo (e, se aquele pedido for cancelado depois,
    // o estorno soma em cima do estoque real, não de um valor "resetado").
    const original = numeroOriginalOuNulo(formData.get(`estoqueAtualOriginal_${item.id}`));
    casPendentes.push({
      nome: item.nome,
      opIndex: operacoes.length,
      itemGraficaId: antesPorItemCatalogoId.get(item.id)!.id,
      original,
      novo: novoEstoqueAtual,
    });
    operacoes.push(
      prisma.itemGrafica.updateMany({
        where: {
          graficaId: usuario.graficaId,
          itemCatalogoId: item.id,
          estoqueAtual: original,
        },
        data: { estoqueAtual: novoEstoqueAtual },
      })
    );
  }

  const resultados = await prisma.$transaction(operacoes);

  // Preço e estoque: registra o antes/depois de cada item que realmente
  // mudou. Refeito com uma segunda leitura (em vez de threadar o valor novo
  // pelo loop de `operacoes` acima) porque item novo, item existente e
  // compare-and-swap de estoque têm três formatos de operação Prisma
  // diferentes — comparar o estado final direto do banco cobre os três sem
  // triplicar a lógica de diff. Melhor esforço, nunca derruba o salvamento
  // (ver registrarAuditoria).
  const itensGraficaDepois = await prisma.itemGrafica.findMany({
    where: { graficaId: usuario.graficaId },
    select: {
      id: true,
      itemCatalogoId: true,
      precoCompra: true,
      precoVenda: true,
      estoqueAtual: true,
      estoqueMinimo: true,
      perdaFixaPadrao: true,
    },
  });
  const depoisPorItemCatalogoId = new Map(itensGraficaDepois.map((i) => [i.itemCatalogoId, i]));
  const CAMPOS_AUDITORIA_CATALOGO = [
    { campo: "precoCompra" as const, rotulo: "Compra", formatar: formatarPreco },
    { campo: "precoVenda" as const, rotulo: "Venda", formatar: formatarPreco },
    { campo: "estoqueAtual" as const, rotulo: "Estoque atual", formatar: formatarQuantidade },
    { campo: "estoqueMinimo" as const, rotulo: "Estoque mínimo", formatar: formatarQuantidade },
    { campo: "perdaFixaPadrao" as const, rotulo: "Perda fixa", formatar: formatarQuantidade },
  ];
  // Carimba ItemGrafica.precoCompraAtualizadoEm só pros itens cujo PREÇO DE
  // COMPRA especificamente mudou (não qualquer campo) — alimenta o aviso de
  // "preço de insumo desatualizado" (ParametrosGrafica.diasPrecoInsumoDesatualizado,
  // achado A1-Parte6 da auditoria de abrangência, 2026-08-24). Reaproveita o
  // diff antes/depois já calculado neste loop, sem query nova por item.
  const idsComPrecoAlterado: string[] = [];

  for (const item of itensCatalogo) {
    const depois = depoisPorItemCatalogoId.get(item.id);
    if (!depois || idsComVariante.has(item.id)) continue; // sem ItemGrafica, ou preço/estoque vive na variante
    const antes = antesPorItemCatalogoId.get(item.id);

    const antesTextos: string[] = [];
    const depoisTextos: string[] = [];
    for (const { campo, rotulo, formatar } of CAMPOS_AUDITORIA_CATALOGO) {
      const textoAntes = formatar(antes?.[campo] ?? null);
      const textoDepois = formatar(depois[campo]);
      if (textoAntes !== textoDepois) {
        antesTextos.push(`${rotulo}: ${textoAntes}`);
        depoisTextos.push(`${rotulo}: ${textoDepois}`);
        if (campo === "precoCompra") idsComPrecoAlterado.push(depois.id);
      }
    }
    if (antesTextos.length === 0) continue;

    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "catalogo.editar_item",
      entidade: "ItemGrafica",
      entidadeId: depois.id,
      descricao: `Preço/estoque de "${item.nome}" atualizado`,
      valorAnterior: antesTextos.join(", "),
      valorNovo: depoisTextos.join(", "),
    });
  }

  if (idsComPrecoAlterado.length > 0) {
    await prisma.itemGrafica.updateMany({
      where: { id: { in: idsComPrecoAlterado } },
      data: { precoCompraAtualizadoEm: new Date() },
    });
  }

  const itensComEstoqueDivergente = casPendentes
    .filter(({ opIndex }) => (resultados[opIndex] as { count: number }).count === 0)
    .map(({ nome }) => nome);

  // Editar "estoque atual" aqui (fora da tela de lançamento manual em
  // catalogo/[itemGraficaId]) passa a gerar AJUSTE_INVENTARIO em vez de só
  // sobrescrever o campo silenciosamente (fase-custo-real.md §4.3) — mesma
  // conta de delta usada no lançamento manual (calcularDeltaAjusteInventario).
  // Só gera pros CAS que de fato aplicaram (count > 0) e cujo antes/depois
  // são ambos números reais: original null (item nunca teve controle
  // numérico) ou novo null (usuário desligou o controle) não são "ajuste",
  // são liga/desliga de controle de estoque. Melhor-esforço, igual
  // registrarAuditoria acima: nunca derruba um salvamento que já commitou.
  for (const pendente of casPendentes) {
    const sucesso = (resultados[pendente.opIndex] as { count: number }).count > 0;
    if (!sucesso || pendente.original === null || pendente.novo === null) continue;
    const delta = calcularDeltaAjusteInventario(pendente.original, pendente.novo);
    if (delta === 0) continue;
    try {
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: pendente.itemGraficaId,
          tipo: "AJUSTE_INVENTARIO",
          quantidade: delta,
          motivo: "Ajuste de contagem física via cadastro do catálogo",
          criadoPorId: usuario.id,
        },
      });
    } catch (erro) {
      Sentry.captureException(erro, { extra: { itemGraficaId: pendente.itemGraficaId } });
      console.error("[catalogo] falha ao registrar ajuste de inventário", pendente.itemGraficaId, erro);
    }
  }

  revalidatePath("/catalogo");
  revalidatePath("/orcamento");

  if (itensComEstoqueDivergente.length > 0) {
    return {
      ok: true,
      mensagem:
        `Catálogo salvo! Mas o estoque atual de ${itensComEstoqueDivergente.join(", ")} mudou ` +
        `(provavelmente uma baixa de produção) desde que esta tela carregou, então esse valor não ` +
        `foi sobrescrito — os demais campos foram salvos normalmente. Recarregue a página pra ver o ` +
        `estoque atual antes de editá-lo de novo.`,
    };
  }

  return { ok: true, mensagem: "Catálogo atualizado com sucesso!" };
}
