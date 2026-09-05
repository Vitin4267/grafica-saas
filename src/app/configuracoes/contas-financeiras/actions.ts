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
import { dataInputParaUTC } from "@/lib/data";

export type SalvarContaFinanceiraResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";
const MENSAGEM_NOME_VAZIO = "Informe um nome para a conta.";
const MENSAGEM_NOME_DUPLICADO = "Já existe uma conta financeira com esse nome.";
const TIPOS_VALIDOS = ["CONTA_CORRENTE", "CAIXA", "POUPANCA", "CARTEIRA_DIGITAL", "OUTRO"] as const;

function tipoValido(valor: FormDataEntryValue | null): valor is (typeof TIPOS_VALIDOS)[number] {
  return typeof valor === "string" && (TIPOS_VALIDOS as readonly string[]).includes(valor);
}

// Lê saldoInicial/saldoInicialEm do form — os dois são opcionais (achado A15
// da Parte 4 da auditoria de abrangência, 2026-09-04): uma gráfica pode
// cadastrar a conta sem informar de onde ela "começou a contar", já que esta
// rodada nunca soma nada a partir daqui (ver comentário no model
// ContaFinanceira no schema).
function lerSaldoInicial(formData: FormData): { saldoInicial: number; saldoInicialEm: Date | null } | { erro: string } {
  const bruto = String(formData.get("saldoInicial") ?? "").trim();
  const saldoInicial = bruto ? Number(bruto) : 0;
  if (!Number.isFinite(saldoInicial)) {
    return { erro: "Saldo inicial inválido." };
  }
  const dataBruta = String(formData.get("saldoInicialEm") ?? "").trim();
  const saldoInicialEm = dataBruta ? dataInputParaUTC(dataBruta) : null;
  return { saldoInicial, saldoInicialEm };
}

// Cria uma nova conta financeira (conta bancária, caixa, poupança, carteira
// digital) pra gráfica — cadastro de referência, nunca soma automaticamente
// nenhum Pagamento/Despesa já existente (ver comentário no model
// ContaFinanceira no schema 11-financeiro.prisma).
export async function criarContaFinanceira(
  _estadoAnterior: SalvarContaFinanceiraResult | null,
  formData: FormData
): Promise<SalvarContaFinanceiraResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }
  const tipoBruto = formData.get("tipo");
  if (!tipoValido(tipoBruto)) {
    return { ok: false, mensagem: "Tipo de conta inválido." };
  }
  const saldo = lerSaldoInicial(formData);
  if ("erro" in saldo) {
    return { ok: false, mensagem: saldo.erro };
  }

  let novaConta: { id: string };
  try {
    novaConta = await prisma.contaFinanceira.create({
      data: {
        graficaId: usuario.graficaId,
        nome,
        tipo: tipoBruto,
        saldoInicial: saldo.saldoInicial,
        saldoInicialEm: saldo.saldoInicialEm,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_conta_financeira",
    entidade: "ContaFinanceira",
    entidadeId: novaConta.id,
    descricao: `Conta financeira "${nome}" criada`,
  });

  revalidatePath("/configuracoes/contas-financeiras");
  redirect(`/configuracoes/contas-financeiras/${novaConta.id}`);
}

// Edita nome/tipo/saldo inicial de uma conta já existente — nunca mexe em
// `ativa`, ver alternarAtivaContaFinanceira pra isso.
export async function editarContaFinanceira(
  _estadoAnterior: SalvarContaFinanceiraResult | null,
  formData: FormData
): Promise<SalvarContaFinanceiraResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const contaId = String(formData.get("contaId"));
  const conta = await prisma.contaFinanceira.findFirst({
    where: { id: contaId, graficaId: usuario.graficaId },
  });
  if (!conta) {
    return { ok: false, mensagem: "Conta financeira não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: MENSAGEM_NOME_VAZIO };
  }
  const tipoBruto = formData.get("tipo");
  if (!tipoValido(tipoBruto)) {
    return { ok: false, mensagem: "Tipo de conta inválido." };
  }
  const saldo = lerSaldoInicial(formData);
  if ("erro" in saldo) {
    return { ok: false, mensagem: saldo.erro };
  }

  try {
    await prisma.contaFinanceira.update({
      where: { id: contaId },
      data: {
        nome,
        tipo: tipoBruto,
        saldoInicial: saldo.saldoInicial,
        saldoInicialEm: saldo.saldoInicialEm,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: MENSAGEM_NOME_DUPLICADO };
    }
    throw erro;
  }

  if (conta.nome !== nome || conta.tipo !== tipoBruto) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.editar_conta_financeira",
      entidade: "ContaFinanceira",
      entidadeId: contaId,
      descricao: `Conta financeira "${conta.nome}" atualizada`,
      valorAnterior: `Nome: ${conta.nome}, Tipo: ${conta.tipo}`,
      valorNovo: `Nome: ${nome}, Tipo: ${tipoBruto}`,
    });
  }

  revalidatePath(`/configuracoes/contas-financeiras/${contaId}`);
  revalidatePath("/configuracoes/contas-financeiras");
  return { ok: true, mensagem: "Conta financeira atualizada com sucesso!" };
}

// Alterna ativa/inativa — é o equivalente de "remover" desta tela. NUNCA um
// delete físico: Pagamento.contaFinanceiraId e Despesa.contaFinanceiraId são
// onDelete SetNull no schema, e mesmo desativada a conta continua
// preservando o histórico de tudo que já foi vinculado a ela — só some da
// seleção pra vínculo NOVO.
export async function alternarAtivaContaFinanceira(
  _estadoAnterior: SalvarContaFinanceiraResult | null,
  formData: FormData
): Promise<SalvarContaFinanceiraResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const contaId = String(formData.get("contaId"));
  const conta = await prisma.contaFinanceira.findFirst({
    where: { id: contaId, graficaId: usuario.graficaId },
  });
  if (!conta) {
    return { ok: false, mensagem: "Conta financeira não encontrada." };
  }

  await prisma.contaFinanceira.update({
    where: { id: contaId },
    data: { ativa: !conta.ativa },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: conta.ativa ? "configuracoes.desativar_conta_financeira" : "configuracoes.ativar_conta_financeira",
    entidade: "ContaFinanceira",
    entidadeId: contaId,
    descricao: `Conta financeira "${conta.nome}" ${conta.ativa ? "desativada" : "ativada"}`,
  });

  revalidatePath(`/configuracoes/contas-financeiras/${contaId}`);
  revalidatePath("/configuracoes/contas-financeiras");
  return {
    ok: true,
    mensagem: conta.ativa ? "Conta desativada." : "Conta ativada.",
  };
}
