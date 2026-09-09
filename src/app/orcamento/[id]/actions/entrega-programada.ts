"use server";

// Achado B3/Parte 1 da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md) — CRUD do cronograma de entrega COMBINADO com o cliente
// ("produz 60.000 rótulos agora, entrega 10.000/mês por 6 meses"), versão
// CONTRATUAL/DECLARATIVA, ESCOPO DELIBERADAMENTE REDUZIDO (2026-09-09).
// Ver comentário completo no model OrcamentoEntregaProgramada (schema
// 09-orcamento.prisma) pro raciocínio de escopo — em especial, NUNCA cria
// `Entrega` nem `ContaReceber`, NUNCA muda `StatusPedido`. Feature
// PARALELA a faixas.ts (OrcamentoItemFaixaQuantidade, achado B5) e a
// opcoes.actions.ts (OrcamentoOpcao) — não reaproveita nem mexe em nenhum
// dos dois mecanismos.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { dataInputParaUTC } from "@/lib/data";
import {
  MAX_ENTREGAS_PROGRAMADAS,
  validarSomaCronogramaEntrega,
} from "@/lib/orcamento-entrega-programada";

export type EntregaProgramadaResult = { ok: boolean; mensagem: string };

// Soma de OrcamentoItem.quantidade da opção-base (opcaoId: null) — mesma
// referência que PDF/link público usam pra "quantidade total do
// orçamento" (ver comentário de validarSomaCronogramaEntrega). Opções
// alternativas (OrcamentoOpcao) não entram: o cronograma descreve a
// entrega da proposta que de fato vai ser produzida/aprovada.
function somarQuantidadeItensBase(itens: { quantidade: number }[]): number {
  return itens.reduce((acumulado, item) => acumulado + item.quantidade, 0);
}

export async function adicionarEntregaProgramadaOrcamento(
  _estadoAnterior: EntregaProgramadaResult | null,
  formData: FormData
): Promise<EntregaProgramadaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const orcamentoId = String(formData.get("orcamentoId") || "");
  const quantidade = Number(formData.get("quantidade"));
  const dataPrevistaStr = String(formData.get("dataPrevista") || "").trim();
  const localEntrega = String(formData.get("localEntrega") || "").trim();
  const observacao = String(formData.get("observacao") || "").trim();

  if (!orcamentoId) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 1_000_000) {
    return { ok: false, mensagem: "Informe uma quantidade válida (até 1.000.000 unidades)." };
  }

  const orcamento = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, graficaId: usuario.graficaId },
    include: {
      itens: { where: { opcaoId: null }, select: { quantidade: true } },
      entregasProgramadas: { select: { quantidade: true }, orderBy: { ordem: "asc" } },
      _count: { select: { entregasProgramadas: true } },
    },
  });
  if (!orcamento) {
    return { ok: false, mensagem: "Orçamento não encontrado." };
  }
  if (orcamento._count.entregasProgramadas >= MAX_ENTREGAS_PROGRAMADAS) {
    return {
      ok: false,
      mensagem: `Este orçamento já tem o máximo de ${MAX_ENTREGAS_PROGRAMADAS} linhas de cronograma.`,
    };
  }

  const quantidadeTotalOrcamento = somarQuantidadeItensBase(orcamento.itens);
  const resultadoSoma = validarSomaCronogramaEntrega(
    [...orcamento.entregasProgramadas, { quantidade }],
    quantidadeTotalOrcamento
  );
  if (!resultadoSoma.ok) {
    return { ok: false, mensagem: resultadoSoma.mensagem };
  }

  const ordemAtual = orcamento._count.entregasProgramadas;
  await prisma.orcamentoEntregaProgramada.create({
    data: {
      graficaId: usuario.graficaId,
      orcamentoId,
      ordem: ordemAtual,
      quantidade,
      dataPrevista: dataPrevistaStr ? dataInputParaUTC(dataPrevistaStr) : null,
      localEntrega: localEntrega || null,
      observacao: observacao || null,
    },
  });

  revalidatePath(`/orcamento/${orcamentoId}`);

  const mensagem = resultadoSoma.completo
    ? "Linha de cronograma adicionada. A soma já cobre a quantidade total do orçamento."
    : `Linha de cronograma adicionada. Faltam ${resultadoSoma.faltam.toLocaleString("pt-BR")} unidades pra completar o cronograma.`;
  return { ok: true, mensagem };
}

export async function editarEntregaProgramadaOrcamento(
  _estadoAnterior: EntregaProgramadaResult | null,
  formData: FormData
): Promise<EntregaProgramadaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const entregaProgramadaId = String(formData.get("entregaProgramadaId") || "");
  const quantidade = Number(formData.get("quantidade"));
  const dataPrevistaStr = String(formData.get("dataPrevista") || "").trim();
  const localEntrega = String(formData.get("localEntrega") || "").trim();
  const observacao = String(formData.get("observacao") || "").trim();

  if (!entregaProgramadaId) {
    return { ok: false, mensagem: "Linha de cronograma não encontrada." };
  }
  if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 1_000_000) {
    return { ok: false, mensagem: "Informe uma quantidade válida (até 1.000.000 unidades)." };
  }

  const linha = await prisma.orcamentoEntregaProgramada.findFirst({
    where: { id: entregaProgramadaId, graficaId: usuario.graficaId },
    include: {
      orcamento: {
        include: {
          itens: { where: { opcaoId: null }, select: { quantidade: true } },
          entregasProgramadas: { select: { id: true, quantidade: true } },
        },
      },
    },
  });
  if (!linha) {
    return { ok: false, mensagem: "Linha de cronograma não encontrada." };
  }

  const quantidadeTotalOrcamento = somarQuantidadeItensBase(linha.orcamento.itens);
  const outrasLinhas = linha.orcamento.entregasProgramadas.filter((l) => l.id !== entregaProgramadaId);
  const resultadoSoma = validarSomaCronogramaEntrega(
    [...outrasLinhas, { quantidade }],
    quantidadeTotalOrcamento
  );
  if (!resultadoSoma.ok) {
    return { ok: false, mensagem: resultadoSoma.mensagem };
  }

  await prisma.orcamentoEntregaProgramada.update({
    where: { id: entregaProgramadaId },
    data: {
      quantidade,
      dataPrevista: dataPrevistaStr ? dataInputParaUTC(dataPrevistaStr) : null,
      localEntrega: localEntrega || null,
      observacao: observacao || null,
    },
  });

  revalidatePath(`/orcamento/${linha.orcamentoId}`);

  return { ok: true, mensagem: "Linha de cronograma atualizada." };
}

export async function removerEntregaProgramadaOrcamento(
  _estadoAnterior: EntregaProgramadaResult | null,
  formData: FormData
): Promise<EntregaProgramadaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  const entregaProgramadaId = String(formData.get("entregaProgramadaId") || "");
  if (!entregaProgramadaId) {
    return { ok: false, mensagem: "Linha de cronograma não encontrada." };
  }

  const linha = await prisma.orcamentoEntregaProgramada.findFirst({
    where: { id: entregaProgramadaId, graficaId: usuario.graficaId },
    select: { orcamentoId: true },
  });
  if (!linha) {
    return { ok: false, mensagem: "Linha de cronograma não encontrada." };
  }

  await prisma.orcamentoEntregaProgramada.delete({ where: { id: entregaProgramadaId } });

  revalidatePath(`/orcamento/${linha.orcamentoId}`);

  return { ok: true, mensagem: "Linha de cronograma removida." };
}
