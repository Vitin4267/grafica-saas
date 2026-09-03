"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { ehViolacaoDeChaveEstrangeira } from "@/lib/prisma-conflito";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";

export type SalvarMaquinaTempoResult = { ok: boolean; mensagem: string };

// Achado A6 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// Parte 1) — mesmo padrão de CRUD de ImpressoraDigital/MaquinaSetupPorPeca:
// "Nova máquina" grava só o nome, os custos ficam com o default 0 (schema)
// até o usuário editar na tela seguinte.
export async function criarMaquinaTempo(
  _estadoAnterior: SalvarMaquinaTempoResult | null,
  formData: FormData
): Promise<SalvarMaquinaTempoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a máquina." };
  }

  let novaMaquina: { id: string };
  try {
    novaMaquina = await prisma.maquinaTempo.create({
      data: { graficaId: usuario.graficaId, nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma máquina com esse nome." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_maquina_tempo",
    entidade: "MaquinaTempo",
    entidadeId: novaMaquina.id,
    descricao: `Máquina "${nome}" (tempo de máquina) criada`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect(`/configuracoes/maquinas/tempo-maquina/${novaMaquina.id}`);
}

export async function salvarMaquinaTempo(
  _estadoAnterior: SalvarMaquinaTempoResult | null,
  formData: FormData
): Promise<SalvarMaquinaTempoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaTempo.findFirst({
    where: { id: maquinaId, graficaId: usuario.graficaId },
  });
  if (!maquina) {
    return { ok: false, mensagem: "Máquina não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a máquina." };
  }
  const ativa = formData.get("ativa") === "on";

  const custoHoraMaq = Number(formData.get("custoHoraMaq"));
  if (!Number.isFinite(custoHoraMaq) || custoHoraMaq < 0) {
    return { ok: false, mensagem: 'Valor inválido em "Custo por hora de máquina".' };
  }
  const custoSetupPorJob = Number(formData.get("custoSetupPorJob"));
  if (!Number.isFinite(custoSetupPorJob) || custoSetupPorJob < 0) {
    return { ok: false, mensagem: 'Valor inválido em "Custo de setup por job".' };
  }
  // Opcionais de verdade (corte a metro só faz sentido pra plotter/router;
  // nem toda máquina tem piso) — "" no form vira null, mesmo padrão de
  // ConfiguracaoAcabamentoForm.custoFerramental.
  const custoMinimoRaw = formData.get("custoMinimo");
  const custoMinimo = custoMinimoRaw ? Number(custoMinimoRaw) : null;
  if (custoMinimo !== null && (!Number.isFinite(custoMinimo) || custoMinimo < 0)) {
    return { ok: false, mensagem: 'Valor inválido em "Custo mínimo do job".' };
  }
  const custoPorMetroCorteRaw = formData.get("custoPorMetroCorte");
  const custoPorMetroCorte = custoPorMetroCorteRaw ? Number(custoPorMetroCorteRaw) : null;
  if (custoPorMetroCorte !== null && (!Number.isFinite(custoPorMetroCorte) || custoPorMetroCorte < 0)) {
    return { ok: false, mensagem: 'Valor inválido em "Custo por metro de corte".' };
  }

  try {
    await prisma.maquinaTempo.update({
      where: { id: maquinaId },
      data: {
        nome,
        ativa,
        custoHoraMaq,
        custoSetupPorJob,
        custoMinimo,
        custoPorMetroCorte,
      },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma máquina com esse nome." };
    }
    throw erro;
  }

  const diff = criarDiffCampos();
  diff.campo("Nome", maquina.nome, nome);
  diff.campo("Ativa", maquina.ativa, ativa);
  diff.campo("Custo por hora de máquina", Number(maquina.custoHoraMaq), custoHoraMaq);
  diff.campo("Custo de setup por job", Number(maquina.custoSetupPorJob), custoSetupPorJob);
  diff.campo("Custo mínimo do job", maquina.custoMinimo !== null ? Number(maquina.custoMinimo) : null, custoMinimo);
  diff.campo(
    "Custo por metro de corte",
    maquina.custoPorMetroCorte !== null ? Number(maquina.custoPorMetroCorte) : null,
    custoPorMetroCorte
  );
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_maquina_tempo",
      entidade: "MaquinaTempo",
      entidadeId: maquinaId,
      descricao: `Máquina "${maquina.nome}" atualizada`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/maquinas/tempo-maquina/${maquinaId}`);
  revalidatePath("/configuracoes/maquinas");
  return { ok: true, mensagem: "Máquina salva com sucesso!" };
}

export async function excluirMaquinaTempo(
  _estadoAnterior: SalvarMaquinaTempoResult | null,
  formData: FormData
): Promise<SalvarMaquinaTempoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaTempo.findFirst({
    where: { id: maquinaId, graficaId: usuario.graficaId },
  });
  if (!maquina) {
    return { ok: false, mensagem: "Máquina não encontrada." };
  }

  try {
    await prisma.maquinaTempo.delete({ where: { id: maquinaId } });
  } catch (erro) {
    if (ehViolacaoDeChaveEstrangeira(erro)) {
      return {
        ok: false,
        mensagem:
          "Esta máquina está em uso por produtos do catálogo — troque a máquina desses produtos antes de excluir.",
      };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.excluir_maquina_tempo",
    entidade: "MaquinaTempo",
    entidadeId: maquinaId,
    descricao: `Máquina "${maquina.nome}" excluída`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect("/configuracoes/maquinas");
}
