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
import { D, paraDecimal } from "@/lib/pricing/decimal";
import { aplicarPisoDoPedido } from "@/lib/pricing";
import { revalidatePath, updateTag } from "next/cache";
import { UNIDADES_DIMENSAO, converterParaCm } from "@/lib/unidade-dimensao";
import { itemEntradaSchema, etiquetaEntradaSchema } from "@/lib/orcamento-item-entrada";

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
const freteSchema = z.enum([
  "CIF_REMETENTE",
  "FOB_DESTINATARIO",
  "TERCEIROS",
  "PROPRIO_REMETENTE",
  "PROPRIO_DESTINATARIO",
  "SEM_FRETE",
]);

// itemEntradaSchema/etiquetaEntradaSchema (carrinho de itens) vivem em
// src/lib/orcamento-item-entrada.ts — reaproveitado por
// adicionarOpcaoOrcamento (src/app/orcamento/[id]/opcoes.actions.ts), que
// monta um carrinho igual a este pra uma opção alternativa dentro de um
// orçamento já existente.

export type PrecificarItemResult =
  | {
      ok: true;
      nome: string;
      categoria: string;
      precoUnitario: string;
      precoTotal: string;
      modeloCalculo:
        | "SIMPLES"
        | "M2"
        | "OFFSET"
        | "FLEXOGRAFIA"
        | "DIGITAL"
        | "SERIGRAFIA"
        | "SUBLIMACAO"
        | "ESTAMPAGEM_QUENTE"
        | "PERSONALIZACAO"
        | "REVENDA"
        | "BORDADO"
        | "TEMPO_MAQUINA"
        | "DTF";
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
  numeroCoresFlexo: number | null;
  numeroCliques: number | null;
  numeroSetups: number | null;
  numeroPontos: number | null;
  tempoEstimadoMin: number | null;
  metrosCorte: number | null;
  horasEstimadas: number | null;
  acabamentoIds: string[];
  papelId: string | null;
  quantidadeCores: number | null;
  custoFaca: number | null;
  custoFrete: number | null;
  // Motor Offset (achado N8) — gramatura escolhida NESTE orçamento,
  // sobrepondo ItemGrafica.gramaturaGm2 do produto; ausente = usa a
  // gramatura fixa do produto, comportamento de sempre.
  gramaturaGm2: number | null;
  custoAquisicaoUnitario: number | null;
  materialFornecidoPeloCliente: boolean;
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
    numeroCoresFlexo: input.numeroCoresFlexo,
    numeroCliques: input.numeroCliques,
    numeroSetups: input.numeroSetups,
    numeroPontos: input.numeroPontos,
    tempoEstimadoMin: input.tempoEstimadoMin,
    metrosCorte: input.metrosCorte,
    horasEstimadas: input.horasEstimadas,
    acabamentoIds: input.acabamentoIds,
    papelId: input.papelId,
    quantidadeCores: input.quantidadeCores,
    custoFaca: input.custoFaca,
    custoFrete: input.custoFrete,
    gramaturaGm2: input.gramaturaGm2,
    custoAquisicaoUnitario: input.custoAquisicaoUnitario,
    materialFornecidoPeloCliente: input.materialFornecidoPeloCliente,
    // Achado A7 — esta é uma PRÉVIA sem cliente definido (carrinho da
    // Calculadora, antes do orçamento existir) ou sem acesso barato ao
    // cliente já escolhido — sempre usa a margem padrão da gráfica. O
    // cálculo final e persistido (criarOrcamento/adicionarItemOrcamento)
    // aplica o override do cliente corretamente; só a prévia pode
    // subestimar/superestimar o preço em poucos% pra cliente com margem
    // diferenciada, corrigido assim que o item entra de fato no orçamento.
    margemLucroOverride: null,
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

export type CondicoesComerciaisSugeridas = { condicoesPagamento: string | null };

// Achado A6 da Parte 5 da auditoria de abrangência — pré-preenche
// "Condições de pagamento" na Calculadora a partir de
// Cliente.prazoPagamentoPadraoDias/formaPagamentoPreferida. Chamado do
// client component (mesmo padrão RPC de precificarItem acima) só quando o
// vendedor SELECIONA um cliente, nunca embutido na lista de clientes que a
// página já manda pro browser — aquela lista é deliberadamente {id, nome}
// só (ver comentário em src/app/orcamento/page.tsx), pra não vazar dado
// comercial de todo mundo no HTML só pra alimentar um <select>. Aqui o
// retorno é escopado a UM cliente, já autenticado e validado contra
// graficaId, então não repete aquele vazamento.
export async function buscarCondicoesComerciaisCliente(
  clienteId: string
): Promise<CondicoesComerciaisSugeridas> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { condicoesPagamento: null };
  }

  if (!clienteId) {
    return { condicoesPagamento: null };
  }

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
    select: { prazoPagamentoPadraoDias: true, formaPagamentoPreferida: true },
  });
  if (!cliente) {
    return { condicoesPagamento: null };
  }

  const ROTULO_FORMA: Record<string, string> = {
    DINHEIRO: "Dinheiro",
    PIX: "Pix",
    CARTAO: "Cartão",
    BOLETO: "Boleto",
    TRANSFERENCIA: "Transferência",
    OUTRO: "Outro",
  };

  const partes: string[] = [];
  if (cliente.formaPagamentoPreferida) {
    partes.push(ROTULO_FORMA[cliente.formaPagamentoPreferida] ?? cliente.formaPagamentoPreferida);
  }
  if (cliente.prazoPagamentoPadraoDias !== null) {
    partes.push(
      cliente.prazoPagamentoPadraoDias === 0
        ? "à vista"
        : `${cliente.prazoPagamentoPadraoDias} dias`
    );
  }

  return { condicoesPagamento: partes.length > 0 ? partes.join(", ") : null };
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
  // Achado A7 — margemPadraoOverride é propriedade do CLIENTE, constante em
  // todo item deste orçamento (ver DadosItemOrcamento.margemLucroOverride).
  const margemLucroOverride =
    cliente.margemPadraoOverride !== null ? Number(cliente.margemPadraoOverride) : null;

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
    // Achado F7 — nunca passam por calcularItemOrcamento (motor de preço),
    // só gravados direto no OrcamentoItem — ver comentário em
    // itemEntradaSchema (src/lib/orcamento-item-entrada.ts).
    profundidadeCm: number | null;
    espessuraMm: number | null;
    unidadeDimensao: (typeof UNIDADES_DIMENSAO)[number];
    cores: string | null;
    acabamento: string | null;
    descricaoLivre: string | null;
    precoUnitario: string;
    precoTotal: string;
    modeloCalculo:
      | "SIMPLES"
      | "M2"
      | "OFFSET"
      | "FLEXOGRAFIA"
      | "DIGITAL"
      | "SERIGRAFIA"
      | "SUBLIMACAO"
      | "ESTAMPAGEM_QUENTE"
      | "PERSONALIZACAO"
      | "REVENDA"
      | "BORDADO"
      | "TEMPO_MAQUINA"
      | "DTF";
    corFrente: number | null;
    corVerso: number | null;
    numeroCoresFlexo: number | null;
    numeroCliques: number | null;
    numeroSetups: number | null;
    numeroPontos: number | null;
    tempoEstimadoMin: number | null;
    metrosCorte: number | null;
    horasEstimadas: number | null;
    custoAquisicaoUnitario: number | null;
    // Achado N10 — ver comentário em ResultadoItemOrcamento.custoFaca
    // (src/lib/orcamento-precificacao.ts).
    custoFaca: number | null;
    materialFornecidoPeloCliente: boolean;
    breakdown: Prisma.InputJsonValue | null;
    etiqueta: z.infer<typeof etiquetaEntradaSchema> | null;
    acabamentos: { itemGraficaId: string; qtdBase: string; custoCalculado: string }[];
    precificacaoEtiqueta: {
      papelId: string;
      quantidadeCores: number;
      custoClicheCalculado: string;
      custoFaca: string | null;
      custoFrete: string | null;
    } | null;
    // Achado N4 (correção de gap encontrado durante a revisão do N8) —
    // nunca existia aqui antes, mesmo padrão de precificacaoEtiqueta acima.
    precificacaoDigital: { papelId: string } | null;
    // Achado N8 — snapshot do papel/gramatura Offset OVERRIDDEN neste
    // orçamento, mesmo padrão de precificacaoEtiqueta acima.
    precificacaoOffset: { papelId: string | null; gramaturaGm2: number | null } | null;
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
    // Achado F7 — profundidadeCm segue a mesma conversão de largura/altura;
    // espessuraMm já chega em mm (nunca passa por converterParaCm). Nenhum
    // dos dois vai pro motor de preço abaixo (calcularItemOrcamento nem
    // aceita esses campos) — só gravados direto no create mais abaixo.
    const profundidadeCm =
      entrada.profundidade !== null
        ? converterParaCm(entrada.profundidade, entrada.unidadeDimensao)
        : null;
    const espessuraMm = entrada.espessuraMm;

    const resultado = await calcularItemOrcamento(itemGrafica, usuario.graficaId, {
      quantidade: entrada.quantidade,
      larguraCm,
      alturaCm,
      corFrente: entrada.corFrente,
      corVerso: entrada.corVerso,
      numeroCoresFlexo: entrada.numeroCoresFlexo,
      numeroCliques: entrada.numeroCliques,
      numeroSetups: entrada.numeroSetups,
      numeroPontos: entrada.numeroPontos,
      tempoEstimadoMin: entrada.tempoEstimadoMin,
      metrosCorte: entrada.metrosCorte,
      horasEstimadas: entrada.horasEstimadas,
      acabamentoIds: entrada.acabamentoIds,
      papelId: entrada.papelId,
      quantidadeCores: entrada.quantidadeCores,
      custoFaca: entrada.custoFaca,
      custoFrete: entrada.custoFrete,
      gramaturaGm2: entrada.gramaturaGm2,
      custoAquisicaoUnitario: entrada.custoAquisicaoUnitario,
      materialFornecidoPeloCliente: entrada.materialFornecidoPeloCliente,
      margemLucroOverride,
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
      profundidadeCm,
      espessuraMm,
      unidadeDimensao: entrada.unidadeDimensao,
      cores: entrada.cores,
      acabamento: entrada.acabamento,
      descricaoLivre: entrada.descricaoLivre,
      precoUnitario: resultado.precoUnitario,
      precoTotal: resultado.precoTotal,
      modeloCalculo: resultado.modeloCalculo,
      corFrente: resultado.corFrente,
      corVerso: resultado.corVerso,
      numeroCoresFlexo: resultado.numeroCoresFlexo,
      numeroCliques: resultado.numeroCliques,
      numeroSetups: resultado.numeroSetups,
      numeroPontos: resultado.numeroPontos,
      tempoEstimadoMin: resultado.tempoEstimadoMin,
      metrosCorte: resultado.metrosCorte,
      horasEstimadas: resultado.horasEstimadas,
      custoAquisicaoUnitario: resultado.custoAquisicaoUnitario,
      custoFaca: resultado.custoFaca,
      materialFornecidoPeloCliente: resultado.materialFornecidoPeloCliente,
      breakdown: resultado.breakdown,
      etiqueta: entrada.etiqueta,
      acabamentos: resultado.acabamentos,
      precificacaoEtiqueta: resultado.precificacaoEtiqueta,
      precificacaoDigital: resultado.precificacaoDigital,
      precificacaoOffset: resultado.precificacaoOffset,
    });
  }

  // Achado N3 — piso de pedido (ParametrosGrafica.pedidoMinimo) aplicado uma
  // única vez sobre a SOMA dos itens, nunca por item (ver aplicarPisoDoPedido
  // em src/lib/pricing/compor.ts — comporPreco não conhece mais esse campo).
  const parametrosPedidoMinimo = await prisma.parametrosGrafica.findUnique({
    where: { graficaId: usuario.graficaId },
    select: { pedidoMinimo: true, incrementoArredondamento: true },
  });
  total = aplicarPisoDoPedido(
    total,
    paraDecimal(parametrosPedidoMinimo?.pedidoMinimo.toString() ?? "0"),
    paraDecimal(parametrosPedidoMinimo?.incrementoArredondamento.toString() ?? "0.10")
  );

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
          profundidadeCm: item.profundidadeCm,
          espessuraMm: item.espessuraMm,
          unidadeDimensao: item.unidadeDimensao,
          cores: item.cores,
          acabamento: item.acabamento,
          descricaoLivre: item.descricaoLivre,
          precoUnitario: item.precoUnitario,
          precoTotal: item.precoTotal,
          modeloCalculo: item.modeloCalculo,
          corFrente: item.corFrente,
          corVerso: item.corVerso,
          numeroCoresFlexo: item.numeroCoresFlexo,
          numeroCliques: item.numeroCliques,
          numeroSetups: item.numeroSetups,
          numeroPontos: item.numeroPontos,
          tempoEstimadoMin: item.tempoEstimadoMin,
          metrosCorte: item.metrosCorte,
          horasEstimadas: item.horasEstimadas,
          custoAquisicaoUnitario: item.custoAquisicaoUnitario,
          custoFaca: item.custoFaca,
          materialFornecidoPeloCliente: item.materialFornecidoPeloCliente,
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
                    durabilidadeAdesivo: item.etiqueta?.durabilidadeAdesivo || null,
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
                        tipoOutro: h.tipoOutro || null,
                        tipoEfeitoHotStamping: h.tipoEfeitoHotStamping || null,
                        medida: h.medida || null,
                        cor: h.cor || null,
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
          precificacaoEtiqueta: item.precificacaoEtiqueta
            ? {
                create: {
                  papelId: item.precificacaoEtiqueta.papelId,
                  quantidadeCores: item.precificacaoEtiqueta.quantidadeCores,
                  custoClicheCalculado: item.precificacaoEtiqueta.custoClicheCalculado,
                  custoFaca: item.precificacaoEtiqueta.custoFaca,
                  custoFrete: item.precificacaoEtiqueta.custoFrete,
                },
              }
            : undefined,
          // Achado N4 (correção de gap encontrado durante a revisão do N8)
          // — nunca existia aqui antes, mesmo padrão de
          // precificacaoEtiqueta acima.
          precificacaoDigital: item.precificacaoDigital
            ? {
                create: {
                  papelId: item.precificacaoDigital.papelId,
                },
              }
            : undefined,
          // Achado N8 — snapshot do papel/gramatura Offset OVERRIDDEN neste
          // orçamento, mesmo padrão de precificacaoEtiqueta acima.
          precificacaoOffset: item.precificacaoOffset
            ? {
                create: {
                  papelId: item.precificacaoOffset.papelId,
                  gramaturaGm2: item.precificacaoOffset.gramaturaGm2,
                },
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
