"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { FORMAS_PAGAMENTO_VALIDAS, ROTULO_FORMA_PAGAMENTO } from "./tipos";

export type SalvarTaxaFormaPagamentoResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_FORMA_DUPLICADA = "Já existe uma taxa cadastrada pra essa forma de pagamento.";

function formaValida(
  valor: FormDataEntryValue | null
): valor is (typeof FORMAS_PAGAMENTO_VALIDAS)[number] {
  return typeof valor === "string" && (FORMAS_PAGAMENTO_VALIDAS as readonly string[]).includes(valor);
}

// Lê percentual/diasCompensacao do form — mesmo cuidado de validação de
// número finito usado em src/app/configuracoes/contas-financeiras/actions.ts.
function lerPercentualEDias(
  formData: FormData
): { percentual: number; diasCompensacao: number } | { erro: string } {
  const percentualBruto = String(formData.get("percentual") ?? "").trim();
  const percentual = percentualBruto ? Number(percentualBruto) : 0;
  if (!Number.isFinite(percentual) || percentual < 0) {
    return { erro: "Percentual inválido." };
  }
  const diasBruto = String(formData.get("diasCompensacao") ?? "").trim();
  const diasCompensacao = diasBruto ? Number(diasBruto) : 0;
  if (!Number.isInteger(diasCompensacao) || diasCompensacao < 0) {
    return { erro: "Dias de compensação inválido." };
  }
  return { percentual, diasCompensacao };
}

// Cria um cadastro de taxa por forma de pagamento (ex: "Cartão de crédito:
// 3,5% / 30 dias") — achado A11 da Parte 4 da auditoria de abrangência
// (2026-09-08). Cadastro de referência: só alimenta o pré-preenchimento
// OPCIONAL de Pagamento.valorTaxa no momento de um registro novo, nunca
// recalcula/reescreve pagamento já existente (ver comentário no schema).
export async function criarTaxaFormaPagamento(
  _estadoAnterior: SalvarTaxaFormaPagamentoResult | null,
  formData: FormData
): Promise<SalvarTaxaFormaPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const formaBruta = formData.get("forma");
  if (!formaValida(formaBruta)) {
    return { ok: false, mensagem: "Forma de pagamento inválida." };
  }
  const lido = lerPercentualEDias(formData);
  if ("erro" in lido) {
    return { ok: false, mensagem: lido.erro };
  }

  let nova: { id: string };
  try {
    nova = await prisma.taxaFormaPagamento.create({
      data: {
        graficaId: usuario.graficaId,
        forma: formaBruta,
        percentual: lido.percentual,
        diasCompensacao: lido.diasCompensacao,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_FORMA_DUPLICADA };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_taxa_forma_pagamento",
    entidade: "TaxaFormaPagamento",
    entidadeId: nova.id,
    descricao: `Taxa de "${ROTULO_FORMA_PAGAMENTO[formaBruta] ?? formaBruta}" cadastrada (${lido.percentual}% / ${lido.diasCompensacao} dias)`,
  });

  revalidatePath("/configuracoes/taxas-forma-pagamento");
  redirect(`/configuracoes/taxas-forma-pagamento/${nova.id}`);
}

// Edita percentual/diasCompensacao de um cadastro já existente — nunca mexe
// em `forma` (trocar a forma é excluir e criar de novo, evita confundir
// pagamentos antigos que já usaram o pré-preenchimento desta linha) nem em
// `ativa` (ver alternarAtivaTaxaFormaPagamento pra isso).
export async function editarTaxaFormaPagamento(
  _estadoAnterior: SalvarTaxaFormaPagamentoResult | null,
  formData: FormData
): Promise<SalvarTaxaFormaPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const taxaId = String(formData.get("taxaId"));
  const taxa = await prisma.taxaFormaPagamento.findFirst({
    where: { id: taxaId, graficaId: usuario.graficaId },
  });
  if (!taxa) {
    return { ok: false, mensagem: "Taxa não encontrada." };
  }

  const lido = lerPercentualEDias(formData);
  if ("erro" in lido) {
    return { ok: false, mensagem: lido.erro };
  }

  await prisma.taxaFormaPagamento.update({
    where: { id: taxaId },
    data: { percentual: lido.percentual, diasCompensacao: lido.diasCompensacao },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.editar_taxa_forma_pagamento",
    entidade: "TaxaFormaPagamento",
    entidadeId: taxaId,
    descricao: `Taxa de "${ROTULO_FORMA_PAGAMENTO[taxa.forma] ?? taxa.forma}" atualizada`,
    valorAnterior: `${taxa.percentual}% / ${taxa.diasCompensacao} dias`,
    valorNovo: `${lido.percentual}% / ${lido.diasCompensacao} dias`,
  });

  revalidatePath(`/configuracoes/taxas-forma-pagamento/${taxaId}`);
  revalidatePath("/configuracoes/taxas-forma-pagamento");
  return { ok: true, mensagem: "Taxa atualizada com sucesso!" };
}

// Alterna ativa/inativa — equivalente de "remover" desta tela, mesmo padrão
// de alternarAtivaContaFinanceira. Nunca hard-delete: preserva o histórico
// (mesmo cadastro que já pré-preencheu pagamentos passados continua
// rastreável), só some da seleção de pré-preenchimento pra pagamento NOVO.
export async function alternarAtivaTaxaFormaPagamento(
  _estadoAnterior: SalvarTaxaFormaPagamentoResult | null,
  formData: FormData
): Promise<SalvarTaxaFormaPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const taxaId = String(formData.get("taxaId"));
  const taxa = await prisma.taxaFormaPagamento.findFirst({
    where: { id: taxaId, graficaId: usuario.graficaId },
  });
  if (!taxa) {
    return { ok: false, mensagem: "Taxa não encontrada." };
  }

  await prisma.taxaFormaPagamento.update({
    where: { id: taxaId },
    data: { ativa: !taxa.ativa },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: taxa.ativa ? "configuracoes.desativar_taxa_forma_pagamento" : "configuracoes.ativar_taxa_forma_pagamento",
    entidade: "TaxaFormaPagamento",
    entidadeId: taxaId,
    descricao: `Taxa de "${ROTULO_FORMA_PAGAMENTO[taxa.forma] ?? taxa.forma}" ${taxa.ativa ? "desativada" : "ativada"}`,
  });

  revalidatePath(`/configuracoes/taxas-forma-pagamento/${taxaId}`);
  revalidatePath("/configuracoes/taxas-forma-pagamento");
  return {
    ok: true,
    mensagem: taxa.ativa ? "Taxa desativada." : "Taxa ativada.",
  };
}
