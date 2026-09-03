"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { TipoAlcada, PapelUsuario } from "@/generated/prisma/enums";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { ROTULO_PAPEL } from "@/lib/papel-usuario";
import { PAPEIS_PARA_ALCADA, TIPOS_ALCADA, ROTULO_TIPO_ALCADA } from "@/lib/alcada-aprovacao";

export type SalvarAlcadaResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";

function rotuloAlvo(papel: PapelUsuario | null, usuarioNome: string | null): string {
  if (papel) return `papel ${ROTULO_PAPEL[papel] ?? papel}`;
  return `usuário ${usuarioNome ?? "—"}`;
}

// Valida tipo + alvo (papel XOR usuarioId, achado A4 da auditoria de
// abrangência — mesmo padrão de "exatamente um preenchido" que
// RegistroManutencao já usa pras 5 FKs de máquina, ver validarSelecaoMaquina
// em src/lib/manutencao-maquina.ts, aqui sem constraint de banco) + limite
// dentro da faixa certa pro tipo (0-100 pra DESCONTO_ORCAMENTO — é
// percentual —, maior que zero pra APROVACAO_COMPRA — é R$). Compartilhada
// entre criar/editar.
async function validarDadosAlcada(
  formData: FormData,
  graficaId: string
): Promise<
  | {
      ok: true;
      tipo: TipoAlcada;
      papel: PapelUsuario | null;
      usuarioId: string | null;
      limite: number;
    }
  | { ok: false; mensagem: string }
> {
  const tipoBruto = String(formData.get("tipo") ?? "");
  if (!TIPOS_ALCADA.includes(tipoBruto as TipoAlcada)) {
    return { ok: false, mensagem: "Selecione o tipo de alçada." };
  }
  const tipo = tipoBruto as TipoAlcada;

  const alvo = String(formData.get("alvo") ?? "");
  let papel: PapelUsuario | null = null;
  let usuarioId: string | null = null;
  if (alvo === "PAPEL") {
    const papelBruto = String(formData.get("papel") ?? "");
    if (!PAPEIS_PARA_ALCADA.includes(papelBruto as PapelUsuario)) {
      return { ok: false, mensagem: "Selecione o papel pra esta alçada." };
    }
    papel = papelBruto as PapelUsuario;
  } else if (alvo === "USUARIO") {
    const usuarioIdBruto = String(formData.get("usuarioId") ?? "").trim();
    if (!usuarioIdBruto) {
      return { ok: false, mensagem: "Selecione o usuário pra esta alçada." };
    }
    const usuarioAlvo = await prisma.usuario.findFirst({
      where: { id: usuarioIdBruto, graficaId, desativadoEm: null },
      select: { id: true },
    });
    if (!usuarioAlvo) {
      return { ok: false, mensagem: "Usuário não encontrado." };
    }
    usuarioId = usuarioAlvo.id;
  } else {
    return { ok: false, mensagem: "Selecione se a alçada é por papel ou por usuário específico." };
  }

  const limiteBruto = formData.get("limite");
  const limite = Number(limiteBruto);
  if (!Number.isFinite(limite) || limite <= 0) {
    return { ok: false, mensagem: "Informe um limite maior que zero." };
  }
  if (tipo === "DESCONTO_ORCAMENTO" && limite > 100) {
    return { ok: false, mensagem: "O limite de desconto é um percentual — informe um valor entre 0 e 100." };
  }

  return { ok: true, tipo, papel, usuarioId, limite };
}

// Cria uma AlcadaAprovacao — achado A4 da auditoria de abrangência (Parte 6/
// Configurações, pesquisa-abrangencia-modulos.md, 2026-09-02). Nunca duas
// linhas do mesmo tipo pro mesmo alvo (papel ou usuário): resolverLimiteDesconto/
// resolverLimiteAprovacaoCompra (src/lib/alcada-aprovacao.ts) pegam a
// PRIMEIRA que baterem, então duplicata seria ambígua — bloqueado aqui, não
// por constraint de banco (mesmo espírito do resto desta tela).
export async function criarAlcada(
  _estadoAnterior: SalvarAlcadaResult | null,
  formData: FormData
): Promise<SalvarAlcadaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const validado = await validarDadosAlcada(formData, usuario.graficaId);
  if (!validado.ok) {
    return validado;
  }
  const { tipo, papel, usuarioId, limite } = validado;

  const existente = await prisma.alcadaAprovacao.findFirst({
    where: {
      graficaId: usuario.graficaId,
      tipo,
      ...(papel ? { papel } : { usuarioId }),
    },
    select: { id: true },
  });
  if (existente) {
    return {
      ok: false,
      mensagem: "Já existe uma alçada deste tipo cadastrada pra este alvo — edite a existente em vez de criar outra.",
    };
  }

  let usuarioAlvoNome: string | null = null;
  if (usuarioId) {
    const usuarioAlvo = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } });
    usuarioAlvoNome = usuarioAlvo?.nome ?? null;
  }

  const novaAlcada = await prisma.alcadaAprovacao.create({
    data: { graficaId: usuario.graficaId, tipo, papel, usuarioId, limite: limite.toFixed(2) },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_alcada",
    entidade: "AlcadaAprovacao",
    entidadeId: novaAlcada.id,
    descricao: `Alçada de "${ROTULO_TIPO_ALCADA[tipo]}" criada pro ${rotuloAlvo(papel, usuarioAlvoNome)} (limite ${limite})`,
  });

  revalidatePath("/configuracoes/alcadas");
  return { ok: true, mensagem: "Alçada cadastrada." };
}

// Edita só o LIMITE de uma alçada já existente — trocar o alvo (papel/
// usuário) ou o tipo é, na prática, uma alçada diferente: exclua e cadastre
// outra (mesmo espírito de feriados: campo "quente" edita, o resto
// recadastra).
export async function editarAlcada(
  _estadoAnterior: SalvarAlcadaResult | null,
  formData: FormData
): Promise<SalvarAlcadaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const alcadaId = String(formData.get("alcadaId") ?? "");
  const alcada = await prisma.alcadaAprovacao.findFirst({
    where: { id: alcadaId, graficaId: usuario.graficaId },
  });
  if (!alcada) {
    return { ok: false, mensagem: "Alçada não encontrada." };
  }

  const limiteBruto = formData.get("limite");
  const limite = Number(limiteBruto);
  if (!Number.isFinite(limite) || limite <= 0) {
    return { ok: false, mensagem: "Informe um limite maior que zero." };
  }
  if (alcada.tipo === "DESCONTO_ORCAMENTO" && limite > 100) {
    return { ok: false, mensagem: "O limite de desconto é um percentual — informe um valor entre 0 e 100." };
  }

  const limiteAnterior = Number(alcada.limite);
  await prisma.alcadaAprovacao.update({
    where: { id: alcadaId },
    data: { limite: limite.toFixed(2) },
  });

  if (limiteAnterior !== limite) {
    let usuarioAlvoNome: string | null = null;
    if (alcada.usuarioId) {
      const usuarioAlvo = await prisma.usuario.findUnique({
        where: { id: alcada.usuarioId },
        select: { nome: true },
      });
      usuarioAlvoNome = usuarioAlvo?.nome ?? null;
    }
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.editar_alcada",
      entidade: "AlcadaAprovacao",
      entidadeId: alcadaId,
      descricao: `Alçada de "${ROTULO_TIPO_ALCADA[alcada.tipo]}" (${rotuloAlvo(alcada.papel, usuarioAlvoNome)}) atualizada`,
      valorAnterior: String(limiteAnterior),
      valorNovo: String(limite),
    });
  }

  revalidatePath("/configuracoes/alcadas");
  return { ok: true, mensagem: "Alçada atualizada." };
}

// Remove uma alçada — sem soft-delete de propósito: nada referencia
// AlcadaAprovacao por FK (é só lida, nunca apontada), e removê-la
// simplesmente faz o alvo voltar pro fallback de sempre (ver
// resolverLimiteDesconto/resolverLimiteAprovacaoCompra) — mesmo raciocínio
// de FeriadoGrafica.
export async function excluirAlcada(
  _estadoAnterior: SalvarAlcadaResult | null,
  formData: FormData
): Promise<SalvarAlcadaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const alcadaId = String(formData.get("alcadaId") ?? "");
  const alcada = await prisma.alcadaAprovacao.findFirst({
    where: { id: alcadaId, graficaId: usuario.graficaId },
  });
  if (!alcada) {
    return { ok: false, mensagem: "Alçada não encontrada." };
  }

  let usuarioAlvoNome: string | null = null;
  if (alcada.usuarioId) {
    const usuarioAlvo = await prisma.usuario.findUnique({ where: { id: alcada.usuarioId }, select: { nome: true } });
    usuarioAlvoNome = usuarioAlvo?.nome ?? null;
  }

  await prisma.alcadaAprovacao.delete({ where: { id: alcadaId } });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.excluir_alcada",
    entidade: "AlcadaAprovacao",
    entidadeId: alcadaId,
    descricao: `Alçada de "${ROTULO_TIPO_ALCADA[alcada.tipo]}" (${rotuloAlvo(alcada.papel, usuarioAlvoNome)}) excluída`,
  });

  revalidatePath("/configuracoes/alcadas");
  return { ok: true, mensagem: "Alçada excluída." };
}
