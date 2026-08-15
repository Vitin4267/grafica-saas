"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { calcularItemOrcamento } from "@/lib/orcamento-precificacao";
import { parseJsonArray } from "@/lib/form-json";
import { D } from "@/lib/pricing/decimal";
import { revalidatePath, updateTag } from "next/cache";
import { UNIDADES_DIMENSAO, converterParaCm } from "@/lib/unidade-dimensao";

// Nunca confia na unidade que vem do formulário/JSON — validada contra as
// únicas 3 que existem (ver src/lib/unidade-dimensao.ts) antes de converter
// pra centímetro na fronteira.
const unidadeDimensaoSchema = z.enum(UNIDADES_DIMENSAO);

// Campos gerais do orçamento (bloco 1) — mesmos schemas/validação de
// editarDadosGeraisOrcamento em src/app/orcamento/[id]/actions.ts, só que
// aqui é preenchimento inicial na criação, não edição posterior.
const tipoPedidoSchema = z.enum([
  "MODELO_NOVO",
  "REPETICAO_SEM_ALTERACAO",
  "REPETICAO_COM_ALTERACAO",
]);
const freteSchema = z.enum(["EMITENTE", "DESTINATARIO"]);

// Detalhe descritivo/de produção de etiqueta (OrcamentoItemEtiqueta) — só
// relevante quando o item usa modeloCalculo=M2 (flexografia). NÃO entra na
// conta de preço (ver src/lib/pricing/m2.ts), então esse bloco fica solto do
// resto do cálculo, só carregado até o create no fim de criarOrcamento.
const ladoEtiquetaSchema = z.enum(["ROTULO", "CONTRA_ROTULO"]);
const materialSubstratoSchema = z.enum([
  "PAPEL_TERMICO",
  "COUCHE_C_ROT",
  "BOPP_METALIZADO_ROT",
  "BOPP_BCO_PEROLIZADO",
  "BOPP_BCO_FOSCO",
  "BOPP_TRANSPARENTE",
  "L2_SEM_ADESIVO",
  "POLIETILENO_BRANCO",
  "POLIETILENO_TRANSPARENTE",
  "POLIESTER_BRANCO",
  "POLIESTER_TRANSPARENTE",
  "POLIESTER_CROMO_FOSCO",
  "ELETROSTATICO_SEM_COLA",
  "OUTRO",
]);
const tipoAdesivoSchema = z.enum([
  "ACRILICO_20G",
  "ACRILICO_30G",
  "BORRACHA_20G",
  "BORRACHA_25G",
  "BORRACHA_30G",
  "BORRACHA_50G",
  "OUTRO",
]);
const superficieAplicacaoSchema = z.enum(["VIDRO", "PLASTICO", "METAL", "PAPEL", "PAPELAO", "OUTROS"]);
const tipoRotulagemSchema = z.enum(["MANUAL", "AUTOMATICA"]);
const tipoSerrilhaSchema = z.enum(["SERRILHA", "MICRO_SERRILHA", "GAP", "OUTRO"]);
const tipoLaminacaoSchema = z.enum(["BRILHO", "FOSCO", "OUTRO"]);
const tipoAcabamentoVernizSchema = z.enum(["BRILHO", "FOSCO", "RIBBON", "OUTRO"]);
const tipoHotStampingSchema = z.enum(["HOT", "COLD", "OUTRO"]);

const hotStampingEntradaSchema = z
  .object({
    lado: ladoEtiquetaSchema,
    tipo: tipoHotStampingSchema,
    tipoOutro: z.string().max(60).nullable(),
    medida: z.string().max(60).nullable(),
    cor: z.string().max(60).nullable(),
  })
  .refine((dados) => dados.tipo !== "OUTRO" || Boolean(dados.tipoOutro?.trim()), {
    message: 'Descreva o tipo quando escolher "Outro" como tipo de hot/cold stamping.',
  });

const etiquetaEntradaSchema = z
  .object({
    materialSubstrato: materialSubstratoSchema.nullable(),
    materialSubstratoOutro: z.string().max(120).nullable(),
    tipoAdesivo: tipoAdesivoSchema.nullable(),
    tipoAdesivoOutro: z.string().max(120).nullable(),
    superficieAplicacao: superficieAplicacaoSchema.nullable(),
    superficieAplicacaoOutro: z.string().max(120).nullable(),
    formatoEtiqueta: z.string().max(120).nullable(),
    coresRotulo: z.number().int().min(0).nullable(),
    coresContraRotulo: z.number().int().min(0).nullable(),
    embalagemQtdPorRolo: z.number().int().min(0).nullable(),
    tubeteMedida: z.string().max(60).nullable(),
    rotulagem: tipoRotulagemSchema.nullable(),
    serrilha: tipoSerrilhaSchema.nullable(),
    serrilhaOutro: z.string().max(120).nullable(),
    vernizRotuloTotal: z.boolean(),
    vernizRotuloReserva: z.boolean(),
    vernizRotuloTipo: tipoAcabamentoVernizSchema.nullable(),
    vernizRotuloTipoOutro: z.string().max(120).nullable(),
    vernizContraRotuloTotal: z.boolean(),
    vernizContraRotuloReserva: z.boolean(),
    vernizContraRotuloTipo: tipoAcabamentoVernizSchema.nullable(),
    vernizContraRotuloTipoOutro: z.string().max(120).nullable(),
    laminacaoRotulo: tipoLaminacaoSchema.nullable(),
    laminacaoRotuloOutro: z.string().max(120).nullable(),
    laminacaoContraRotulo: tipoLaminacaoSchema.nullable(),
    laminacaoContraRotuloOutro: z.string().max(120).nullable(),
    rebobinamento: z.number().int().min(1).max(8).nullable(),
    // Teto generoso (ninguém cadastra 20 variações de hot stamping num item de
    // verdade) só pra impedir um POST forjado com milhares de linhas.
    hotStampings: hotStampingEntradaSchema.array().max(20),
  })
  .refine(
    (dados) => dados.materialSubstrato !== "OUTRO" || Boolean(dados.materialSubstratoOutro?.trim()),
    { message: 'Descreva o material quando escolher "Outro" como substrato.' }
  )
  .refine((dados) => dados.tipoAdesivo !== "OUTRO" || Boolean(dados.tipoAdesivoOutro?.trim()), {
    message: 'Descreva o adesivo quando escolher "Outro" como tipo de adesivo.',
  })
  .refine(
    (dados) => dados.superficieAplicacao !== "OUTROS" || Boolean(dados.superficieAplicacaoOutro?.trim()),
    { message: 'Descreva a superfície quando escolher "Outros" como superfície de aplicação.' }
  )
  .refine((dados) => dados.serrilha !== "OUTRO" || Boolean(dados.serrilhaOutro?.trim()), {
    message: 'Descreva a serrilha quando escolher "Outro" como serrilha.',
  })
  .refine(
    (dados) => dados.vernizRotuloTipo !== "OUTRO" || Boolean(dados.vernizRotuloTipoOutro?.trim()),
    { message: 'Descreva o acabamento de verniz do rótulo quando escolher "Outro".' }
  )
  .refine(
    (dados) =>
      dados.vernizContraRotuloTipo !== "OUTRO" || Boolean(dados.vernizContraRotuloTipoOutro?.trim()),
    { message: 'Descreva o acabamento de verniz do contra-rótulo quando escolher "Outro".' }
  )
  .refine((dados) => dados.laminacaoRotulo !== "OUTRO" || Boolean(dados.laminacaoRotuloOutro?.trim()), {
    message: 'Descreva a laminação do rótulo quando escolher "Outro".',
  })
  .refine(
    (dados) => dados.laminacaoContraRotulo !== "OUTRO" || Boolean(dados.laminacaoContraRotuloOutro?.trim()),
    { message: 'Descreva a laminação do contra-rótulo quando escolher "Outro".' }
  );

// Item já digitado/computado no carrinho local (client) — o servidor NUNCA confia
// nos preços vindos daqui, só nos dados de entrada; recalcula tudo de novo com
// calcularItemOrcamento antes de gravar (ver criarOrcamento).
const itemEntradaSchema = z.object({
  itemGraficaId: z.string().min(1),
  quantidade: z.number().int().positive().max(1_000_000, "Quantidade não pode passar de 1.000.000 unidades."),
  // Valor DIGITADO na unidade abaixo — NÃO é necessariamente centímetro (ver
  // SeletorItemOrcamento.tsx). Convertido pra cm logo no início de
  // criarOrcamento, antes de qualquer validação/cálculo.
  largura: z.number().positive().nullable(),
  altura: z.number().positive().nullable(),
  unidadeDimensao: unidadeDimensaoSchema,
  corFrente: z.number().int().nullable(),
  corVerso: z.number().int().nullable(),
  cores: z.string().max(60).nullable(),
  acabamento: z.string().max(200).nullable(),
  acabamentoIds: z.array(z.string().min(1)).max(20).default([]),
  etiqueta: etiquetaEntradaSchema.nullable(),
});

export type PrecificarItemResult =
  | {
      ok: true;
      nome: string;
      categoria: string;
      precoUnitario: string;
      precoTotal: string;
      modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
    }
  | { ok: false; mensagem: string };

// Calcula o preço de UM item sem persistir nada — usado pelo carrinho da
// Calculadora de orçamento (e pelo "+ Adicionar item" na tela de detalhe) pra
// mostrar o preço real antes de o item entrar na lista. Itens M2/Offset só têm
// preço conhecido depois desse round-trip (o motor de precificação só roda no
// servidor); itens SIMPLES já têm prévia instantânea no cliente via calcularPreco,
// sem precisar chamar isto.
export async function precificarItem(input: {
  itemGraficaId: string;
  quantidade: number;
  // Valor DIGITADO na unidade `unidadeDimensao` abaixo — NÃO necessariamente
  // centímetro. Convertido logo abaixo, antes de chamar o motor de preço.
  largura: number | null;
  altura: number | null;
  unidadeDimensao: string;
  corFrente: number | null;
  corVerso: number | null;
  acabamentoIds: string[];
}): Promise<PrecificarItemResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  if (!input.itemGraficaId || !input.quantidade || input.quantidade <= 0) {
    return { ok: false, mensagem: "Escolha um produto e uma quantidade válida." };
  }

  // Nunca confia na unidade vinda do cliente — precisa ser uma das 3 que
  // existem antes de converter pra cm.
  const unidadeParsed = unidadeDimensaoSchema.safeParse(input.unidadeDimensao);
  if (!unidadeParsed.success) {
    return { ok: false, mensagem: "Unidade de medida inválida." };
  }
  const larguraCm =
    input.largura !== null ? converterParaCm(input.largura, unidadeParsed.data) : null;
  const alturaCm = input.altura !== null ? converterParaCm(input.altura, unidadeParsed.data) : null;

  // NÃO filtra por precoVenda aqui: um item existir mas estar sem preço é um
  // estado válido do catálogo (produto cadastrado, preço ainda não definido).
  // Filtrar faria esse caso cair no mesmo "não encontrado" de um item que
  // nem existe — mensagem enganosa pro usuário, que só via o produto na
  // lista minutos atrás. Distingue os dois casos abaixo.
  const itemGrafica = await prisma.itemGrafica.findFirst({
    where: {
      id: input.itemGraficaId,
      graficaId: usuario.graficaId,
      ativo: true,
    },
    include: { itemCatalogo: true },
  });
  if (!itemGrafica) {
    return { ok: false, mensagem: "Produto ou serviço não encontrado." };
  }
  if (!itemGrafica.precoVenda) {
    return {
      ok: false,
      mensagem: `O produto "${itemGrafica.itemCatalogo.nome}" está sem preço de venda no catálogo — configure o preço antes de usar em um orçamento.`,
    };
  }

  const resultado = await calcularItemOrcamento(itemGrafica, usuario.graficaId, {
    quantidade: input.quantidade,
    larguraCm,
    alturaCm,
    corFrente: input.corFrente,
    corVerso: input.corVerso,
    acabamentoIds: input.acabamentoIds,
  });
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  return {
    ok: true,
    nome: itemGrafica.itemCatalogo.nome,
    categoria: itemGrafica.itemCatalogo.categoria,
    precoUnitario: resultado.precoUnitario,
    precoTotal: resultado.precoTotal,
    modeloCalculo: resultado.modeloCalculo,
  };
}

export type CriarOrcamentoResult = { ok: boolean; mensagem: string };

export async function criarOrcamento(
  _estadoAnterior: CriarOrcamentoResult | null,
  formData: FormData
): Promise<CriarOrcamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra criar orçamentos." };
  }

  const clienteId = String(formData.get("clienteId"));
  // Teto generoso (nenhum orçamento de verdade chega perto de 100 itens) só
  // pra impedir um POST forjado com milhares de linhas.
  const itensResult = parseJsonArray(formData.get("itensJson"), itemEntradaSchema, { max: 100 });
  if (!itensResult.ok) {
    return { ok: false, mensagem: itensResult.mensagem };
  }
  if (itensResult.data.length === 0) {
    return { ok: false, mensagem: "Adicione pelo menos um item ao orçamento." };
  }

  const tipoPedidoBruto = formData.get("tipoPedido");
  const tipoPedidoParsed = tipoPedidoBruto ? tipoPedidoSchema.safeParse(tipoPedidoBruto) : null;
  if (tipoPedidoParsed && !tipoPedidoParsed.success) {
    return { ok: false, mensagem: "Tipo de pedido inválido." };
  }
  const freteBruto = formData.get("frete");
  const freteParsed = freteBruto ? freteSchema.safeParse(freteBruto) : null;
  if (freteParsed && !freteParsed.success) {
    return { ok: false, mensagem: "Tipo de frete inválido." };
  }
  const campoTexto = (nome: string, max: number) =>
    String(formData.get(nome) || "").trim().slice(0, max) || null;
  const dadosGerais = {
    vendedor: campoTexto("vendedor", 120),
    tipoPedido: tipoPedidoParsed?.success ? tipoPedidoParsed.data : null,
    contatoNome: campoTexto("contatoNome", 120),
    contatoEmail: campoTexto("contatoEmail", 200),
    condicoesPagamento: campoTexto("condicoesPagamento", 200),
    frete: freteParsed?.success ? freteParsed.data : null,
    transportadora: campoTexto("transportadora", 120),
    localEntrega: campoTexto("localEntrega", 500),
    observacoes: campoTexto("observacoes", 2000),
  };

  // graficaId sempre vem da sessão autenticada, nunca do formulário: impede que
  // um tenant referencie cliente/item de outra gráfica.
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
  });
  if (!cliente) {
    return { ok: false, mensagem: "Cliente não encontrado." };
  }

  // Opcional — string vazia (gráfica sem filial cadastrada, campo nem
  // aparece no form) vira undefined. Sempre revalidado contra graficaId,
  // mesmo cuidado de cliente acima.
  const filialIdBruto = String(formData.get("filialId") ?? "").trim();
  let filialId: string | undefined;
  if (filialIdBruto) {
    const filial = await prisma.filial.findFirst({
      where: { id: filialIdBruto, graficaId: usuario.graficaId },
    });
    if (!filial) {
      return { ok: false, mensagem: "Filial não encontrada." };
    }
    filialId = filial.id;
  }

  // Soma em decimal.js (mesma instância configurada usada pelo motor de
  // precificação, src/lib/pricing/decimal.ts) — nunca em Number(), pra não
  // arriscar imprecisão de ponto flutuante binário numa soma de dinheiro.
  let total = new D(0);
  const itensParaCriar: {
    itemGraficaId: string;
    quantidade: number;
    larguraCm: number | null;
    alturaCm: number | null;
    unidadeDimensao: (typeof UNIDADES_DIMENSAO)[number];
    cores: string | null;
    acabamento: string | null;
    precoUnitario: string;
    precoTotal: string;
    modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
    corFrente: number | null;
    corVerso: number | null;
    breakdown: Prisma.InputJsonValue | null;
    etiqueta: z.infer<typeof etiquetaEntradaSchema> | null;
    acabamentos: { itemGraficaId: string; qtdBase: string; custoCalculado: string }[];
  }[] = [];

  // Recalcula cada item no servidor — nunca confia no preço que veio do carrinho
  // do cliente (poderia ter sido adulterado no DOM/DevTools).
  for (const [indice, entrada] of itensResult.data.entries()) {
    // Mesmo cuidado de precificarItem acima: não filtra por precoVenda na
    // query, senão um item que existe mas está sem preço cai na mensagem
    // genérica de "não encontrado" — enganoso pro usuário, que escolheu o
    // produto de uma lista onde ele aparecia normalmente.
    const itemGrafica = await prisma.itemGrafica.findFirst({
      where: {
        id: entrada.itemGraficaId,
        graficaId: usuario.graficaId,
        ativo: true,
      },
      include: { itemCatalogo: true },
    });
    if (!itemGrafica) {
      return { ok: false, mensagem: `Item ${indice + 1}: produto ou serviço não encontrado.` };
    }
    if (!itemGrafica.precoVenda) {
      return {
        ok: false,
        mensagem: `Item ${indice + 1}: o produto "${itemGrafica.itemCatalogo.nome}" está sem preço de venda no catálogo — configure o preço antes de usar em um orçamento.`,
      };
    }

    // Convertido pra cm AQUI, antes de qualquer validação de dimensão ou
    // chamada ao motor de preço — entrada.largura/altura vêm na unidade que
    // o usuário efetivamente digitou (entrada.unidadeDimensao), nunca cm
    // direto (ver SeletorItemOrcamento.tsx).
    const larguraCm =
      entrada.largura !== null ? converterParaCm(entrada.largura, entrada.unidadeDimensao) : null;
    const alturaCm =
      entrada.altura !== null ? converterParaCm(entrada.altura, entrada.unidadeDimensao) : null;

    const resultado = await calcularItemOrcamento(itemGrafica, usuario.graficaId, {
      quantidade: entrada.quantidade,
      larguraCm,
      alturaCm,
      corFrente: entrada.corFrente,
      corVerso: entrada.corVerso,
      acabamentoIds: entrada.acabamentoIds,
    });
    if (!resultado.ok) {
      return { ok: false, mensagem: `Item ${indice + 1}: ${resultado.mensagem}` };
    }

    total = total.plus(resultado.precoTotal);
    itensParaCriar.push({
      itemGraficaId: itemGrafica.id,
      quantidade: entrada.quantidade,
      larguraCm,
      alturaCm,
      unidadeDimensao: entrada.unidadeDimensao,
      cores: entrada.cores,
      acabamento: entrada.acabamento,
      precoUnitario: resultado.precoUnitario,
      precoTotal: resultado.precoTotal,
      modeloCalculo: resultado.modeloCalculo,
      corFrente: resultado.corFrente,
      corVerso: resultado.corVerso,
      breakdown: resultado.breakdown,
      etiqueta: entrada.etiqueta,
      acabamentos: resultado.acabamentos,
    });
  }

  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: usuario.graficaId,
      clienteId: cliente.id,
      usuarioId: usuario.id,
      filialId,
      total,
      ...dadosGerais,
      itens: {
        create: itensParaCriar.map((item) => ({
          itemGraficaId: item.itemGraficaId,
          quantidade: item.quantidade,
          larguraCm: item.larguraCm,
          alturaCm: item.alturaCm,
          unidadeDimensao: item.unidadeDimensao,
          cores: item.cores,
          acabamento: item.acabamento,
          precoUnitario: item.precoUnitario,
          precoTotal: item.precoTotal,
          modeloCalculo: item.modeloCalculo,
          corFrente: item.corFrente,
          corVerso: item.corVerso,
          breakdown: item.breakdown ?? undefined,
          // Sempre cria a linha de etiqueta pra item M2 (mesmo com tudo
          // nulo, se o usuário não preencheu nada) — evita "M2 sem
          // etiqueta" como estado possível no resto do código depois.
          etiqueta:
            item.modeloCalculo === "M2"
              ? {
                  create: {
                    materialSubstrato: item.etiqueta?.materialSubstrato ?? null,
                    materialSubstratoOutro: item.etiqueta?.materialSubstratoOutro ?? null,
                    tipoAdesivo: item.etiqueta?.tipoAdesivo ?? null,
                    tipoAdesivoOutro: item.etiqueta?.tipoAdesivoOutro ?? null,
                    superficieAplicacao: item.etiqueta?.superficieAplicacao ?? null,
                    superficieAplicacaoOutro: item.etiqueta?.superficieAplicacaoOutro ?? null,
                    formatoEtiqueta: item.etiqueta?.formatoEtiqueta ?? null,
                    coresRotulo: item.etiqueta?.coresRotulo ?? null,
                    coresContraRotulo: item.etiqueta?.coresContraRotulo ?? null,
                    embalagemQtdPorRolo: item.etiqueta?.embalagemQtdPorRolo ?? null,
                    tubeteMedida: item.etiqueta?.tubeteMedida ?? null,
                    rotulagem: item.etiqueta?.rotulagem ?? null,
                    serrilha: item.etiqueta?.serrilha ?? null,
                    serrilhaOutro: item.etiqueta?.serrilhaOutro ?? null,
                    vernizRotuloTotal: item.etiqueta?.vernizRotuloTotal ?? false,
                    vernizRotuloReserva: item.etiqueta?.vernizRotuloReserva ?? false,
                    vernizRotuloTipo: item.etiqueta?.vernizRotuloTipo ?? null,
                    vernizRotuloTipoOutro: item.etiqueta?.vernizRotuloTipoOutro ?? null,
                    vernizContraRotuloTotal: item.etiqueta?.vernizContraRotuloTotal ?? false,
                    vernizContraRotuloReserva: item.etiqueta?.vernizContraRotuloReserva ?? false,
                    vernizContraRotuloTipo: item.etiqueta?.vernizContraRotuloTipo ?? null,
                    vernizContraRotuloTipoOutro: item.etiqueta?.vernizContraRotuloTipoOutro ?? null,
                    laminacaoRotulo: item.etiqueta?.laminacaoRotulo ?? null,
                    laminacaoRotuloOutro: item.etiqueta?.laminacaoRotuloOutro ?? null,
                    laminacaoContraRotulo: item.etiqueta?.laminacaoContraRotulo ?? null,
                    laminacaoContraRotuloOutro: item.etiqueta?.laminacaoContraRotuloOutro ?? null,
                    rebobinamento: item.etiqueta?.rebobinamento ?? null,
                    hotStampings: {
                      create: (item.etiqueta?.hotStampings ?? []).map((h) => ({
                        lado: h.lado,
                        tipo: h.tipo,
                        tipoOutro: h.tipoOutro,
                        medida: h.medida,
                        cor: h.cor,
                      })),
                    },
                  },
                }
              : undefined,
          acabamentos:
            item.acabamentos.length > 0
              ? {
                  create: item.acabamentos.map((a) => ({
                    itemGraficaId: a.itemGraficaId,
                    qtdBase: a.qtdBase,
                    custoCalculado: a.custoCalculado,
                  })),
                }
              : undefined,
        })),
      },
    },
  });

  updateTag(`uso-${usuario.graficaId}`); // orçamento novo muda a contagem do mês (ver src/lib/billing/uso.ts)
  revalidatePath("/orcamento");

  // "É o primeiro orçamento da gráfica?" decidido por CONTAGEM pós-criação
  // (não por um flag em outro lugar do onboarding) — se o total agora é 1,
  // este create acabou de ser o primeiro. Independe de src/lib/onboarding.ts
  // de propósito. Sinalizado só via query string pra página de detalhe
  // mostrar a comemoração — redirect() já corta qualquer valor de retorno
  // desta action, então não dá pra devolver um flag no estado do form.
  const totalOrcamentosDaGrafica = await prisma.orcamento.count({
    where: { graficaId: usuario.graficaId },
  });
  const ehPrimeiroOrcamento = totalOrcamentosDaGrafica === 1;

  redirect(`/orcamento/${orcamento.id}${ehPrimeiroOrcamento ? "?primeiro=1" : ""}`);
}
