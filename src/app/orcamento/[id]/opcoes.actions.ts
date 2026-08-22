"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { calcularItemOrcamento } from "@/lib/orcamento-precificacao";
import { itemEntradaSchema, type ItemEntrada } from "@/lib/orcamento-item-entrada";
import { parseJsonArray } from "@/lib/form-json";
import { D } from "@/lib/pricing/decimal";
import { converterParaCm } from "@/lib/unidade-dimensao";
import { MAX_OPCOES_ALTERNATIVAS } from "@/lib/orcamento-opcoes";

const NOME_OPCAO_MAX = 60;

export type AdicionarOpcaoResult = { ok: boolean; mensagem: string };

// Cria uma opção alternativa ("Opção B", "Pacote Premium" etc — ver model
// OrcamentoOpcao no schema.prisma) dentro de um orçamento já existente,
// reaproveitando exatamente o mesmo carrinho/motor de precificação de
// criarOrcamento (src/app/orcamento/actions.ts): o vendedor monta os itens
// no client (SeletorItemOrcamento + precificarItem pra prévia) e manda tudo
// de uma vez como itensJson, igual à criação de um orçamento novo — MVP não
// tem edição incremental de item dentro de uma opção já criada (isso
// continua exclusivo da opção-base via adicionarItemOrcamento/
// editarOrcamento/removerItemOrcamento), só remover a opção inteira
// (removerOpcaoOrcamento) e recriar.
export async function adicionarOpcaoOrcamento(
  _estadoAnterior: AdicionarOpcaoResult | null,
  formData: FormData
): Promise<AdicionarOpcaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const orcamentoId = String(formData.get("orcamentoId"));
  const nome = String(formData.get("nome") || "").trim().slice(0, NOME_OPCAO_MAX);
  if (!nome) {
    return { ok: false, mensagem: "Dê um nome pra esta opção (ex: \"Opção B\", \"Pacote Premium\")." };
  }

  // Teto generoso (mesmo de criarOrcamento) — impede um POST forjado com
  // milhares de linhas.
  const itensResult = parseJsonArray(formData.get("itensJson"), itemEntradaSchema, { max: 100 });
  if (!itensResult.ok) {
    return { ok: false, mensagem: itensResult.mensagem };
  }
  if (itensResult.data.length === 0) {
    return { ok: false, mensagem: "Adicione pelo menos um item a esta opção." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  // Mesmo gate de adicionarItemOrcamento/editarOrcamento — só dá pra montar
  // opções alternativas enquanto o orçamento ainda não foi enviado ao
  // cliente (preserva a integridade do que já foi visto/decidido).
  if (orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível adicionar opções a um orçamento em rascunho." };
  }

  const quantidadeAtual = await prisma.orcamentoOpcao.count({ where: { orcamentoId } });
  if (quantidadeAtual >= MAX_OPCOES_ALTERNATIVAS) {
    return {
      ok: false,
      mensagem: `Este orçamento já tem o máximo de ${MAX_OPCOES_ALTERNATIVAS} opções alternativas (mais a opção-base).`,
    };
  }

  // Recalcula cada item no servidor — nunca confia no preço que veio do
  // carrinho do cliente (mesmo cuidado de criarOrcamento). Tipo local (não
  // um tipo gerado do Prisma) igual ao de criarOrcamento — só convertido pro
  // shape de `create` de verdade no map final, junto do `orcamentoId`
  // explícito (necessário: `itens` aninhado aqui embaixo de
  // `orcamentoOpcao.create` só resolve o FK opcaoId automaticamente, o FK
  // orcamentoId é uma relação IRMÃ em OrcamentoItem, tem que vir explícito).
  let total = new D(0);
  const itensParaCriar: {
    itemGraficaId: string;
    quantidade: number;
    larguraCm: number | null;
    alturaCm: number | null;
    unidadeDimensao: (typeof itensResult.data)[number]["unidadeDimensao"];
    cores: string | null;
    acabamento: string | null;
    precoUnitario: string;
    precoTotal: string;
    modeloCalculo: "SIMPLES" | "M2" | "OFFSET" | "FLEXOGRAFIA";
    corFrente: number | null;
    corVerso: number | null;
    numeroCoresFlexo: number | null;
    breakdown: Prisma.InputJsonValue | null;
    etiqueta: ItemEntrada["etiqueta"];
    acabamentos: { itemGraficaId: string; qtdBase: string; custoCalculado: string }[];
    precificacaoEtiqueta: {
      papelId: string;
      quantidadeCores: number;
      custoClicheCalculado: string;
      custoFaca: string | null;
      custoFrete: string | null;
    } | null;
  }[] = [];

  for (const [indice, entrada] of itensResult.data.entries()) {
    const itemGrafica = await prisma.itemGrafica.findFirst({
      where: { id: entrada.itemGraficaId, graficaId: usuario.graficaId, ativo: true },
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
      numeroCoresFlexo: entrada.numeroCoresFlexo,
      acabamentoIds: entrada.acabamentoIds,
      papelId: entrada.papelId,
      quantidadeCores: entrada.quantidadeCores,
      custoFaca: entrada.custoFaca,
      custoFrete: entrada.custoFrete,
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
      numeroCoresFlexo: resultado.numeroCoresFlexo,
      breakdown: resultado.breakdown,
      etiqueta: entrada.etiqueta,
      acabamentos: resultado.acabamentos,
      precificacaoEtiqueta: resultado.precificacaoEtiqueta,
    });
  }

  // Monta o shape de `create` de verdade só aqui no fim — mesmo padrão de
  // criarOrcamento (src/app/orcamento/actions.ts): itensParaCriar acima é só
  // um tipo local plano, sem nenhum aninhamento de relação Prisma.
  await prisma.orcamentoOpcao.create({
    data: {
      orcamentoId,
      nome,
      total,
      ordem: quantidadeAtual,
      itens: {
        create: itensParaCriar.map((item) => ({
          orcamentoId,
          itemGraficaId: item.itemGraficaId,
          quantidade: item.quantidade,
          larguraCm: item.larguraCm,
          alturaCm: item.alturaCm,
          unidadeDimensao: item.unidadeDimensao,
          cores: item.cores,
          acabamento: item.acabamento,
          precoUnitario: item.precoUnitario,
          precoTotal: item.precoTotal,
          // Preço sugerido nasce igual ao vendido — mesmo padrão de
          // criarOrcamento/adicionarItemOrcamento; nunca editado depois de
          // gravado (só diverge via um futuro desconto, que este MVP não
          // aplica dentro de uma opção alternativa).
          precoSugeridoUnitario: item.precoUnitario,
          modeloCalculo: item.modeloCalculo,
          corFrente: item.corFrente,
          corVerso: item.corVerso,
          numeroCoresFlexo: item.numeroCoresFlexo,
          breakdown: item.breakdown ?? undefined,
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
        })),
      },
    },
  });

  revalidatePath(`/orcamento/${orcamentoId}`);

  return { ok: true, mensagem: `"${nome}" adicionada com sucesso!` };
}

export type RemoverOpcaoResult = { ok: boolean; mensagem: string };

// Descarta uma opção alternativa por completo (cascade apaga os itens dela)
// — MVP não tem edição incremental dentro de uma opção já criada, então
// "trocar um item" na prática é remover e recriar a opção inteira.
export async function removerOpcaoOrcamento(
  _estadoAnterior: RemoverOpcaoResult | null,
  formData: FormData
): Promise<RemoverOpcaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const opcaoId = String(formData.get("opcaoId"));
  const opcao = await prisma.orcamentoOpcao.findFirst({
    where: { id: opcaoId, orcamento: { graficaId: usuario.graficaId } },
    include: { orcamento: { select: { id: true, status: true } } },
  });
  if (!opcao) {
    return { ok: false, mensagem: "Opção não encontrada." };
  }
  if (opcao.orcamento.status !== "RASCUNHO") {
    return { ok: false, mensagem: "Só é possível remover opções de um orçamento em rascunho." };
  }

  await prisma.orcamentoOpcao.delete({ where: { id: opcaoId } });

  revalidatePath(`/orcamento/${opcao.orcamento.id}`);

  return { ok: true, mensagem: "Opção removida." };
}
