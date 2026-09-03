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

export type SalvarMaquinaBordadoResult = { ok: boolean; mensagem: string };

// Achado A4 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// Parte 1) — mesmo padrão de CRUD de ImpressoraDigital/MaquinaSetupPorPeca:
// "Nova máquina" grava só o nome, os custos ficam com o default 0 (schema)
// até o usuário editar na tela seguinte.
export async function criarMaquinaBordado(
  _estadoAnterior: SalvarMaquinaBordadoResult | null,
  formData: FormData
): Promise<SalvarMaquinaBordadoResult> {
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
    novaMaquina = await prisma.maquinaBordado.create({
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
    acao: "configuracoes.criar_maquina_bordado",
    entidade: "MaquinaBordado",
    entidadeId: novaMaquina.id,
    descricao: `Máquina de bordado "${nome}" criada`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect(`/configuracoes/maquinas/bordado/${novaMaquina.id}`);
}

export async function salvarMaquinaBordado(
  _estadoAnterior: SalvarMaquinaBordadoResult | null,
  formData: FormData
): Promise<SalvarMaquinaBordadoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaBordado.findFirst({
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

  const custoPorMilPontos = Number(formData.get("custoPorMilPontos"));
  if (!Number.isFinite(custoPorMilPontos) || custoPorMilPontos < 0) {
    return { ok: false, mensagem: 'Valor inválido em "Custo por mil pontos".' };
  }
  const custoMatrizDigitalizacao = Number(formData.get("custoMatrizDigitalizacao"));
  if (!Number.isFinite(custoMatrizDigitalizacao) || custoMatrizDigitalizacao < 0) {
    return { ok: false, mensagem: 'Valor inválido em "Taxa de digitalização de matriz".' };
  }
  const cabecasRaw = formData.get("cabecas");
  const cabecas = cabecasRaw ? Number(cabecasRaw) : 1;
  if (!Number.isInteger(cabecas) || cabecas < 1) {
    return { ok: false, mensagem: 'Valor inválido em "Número de cabeças" (mínimo 1).' };
  }
  // Opcionais de verdade (nem toda máquina cobra hora de máquina separada ou
  // tem piso de job) — "" no form vira null, mesmo padrão de
  // ConfiguracaoAcabamentoForm.custoFerramental.
  const custoHoraMaqRaw = formData.get("custoHoraMaq");
  const custoHoraMaq = custoHoraMaqRaw ? Number(custoHoraMaqRaw) : null;
  if (custoHoraMaq !== null && (!Number.isFinite(custoHoraMaq) || custoHoraMaq < 0)) {
    return { ok: false, mensagem: 'Valor inválido em "Custo por hora de máquina".' };
  }
  const custoMinimoRaw = formData.get("custoMinimo");
  const custoMinimo = custoMinimoRaw ? Number(custoMinimoRaw) : null;
  if (custoMinimo !== null && (!Number.isFinite(custoMinimo) || custoMinimo < 0)) {
    return { ok: false, mensagem: 'Valor inválido em "Custo mínimo do job".' };
  }

  try {
    await prisma.maquinaBordado.update({
      where: { id: maquinaId },
      data: {
        nome,
        ativa,
        custoPorMilPontos,
        custoMatrizDigitalizacao,
        cabecas,
        custoHoraMaq,
        custoMinimo,
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
  diff.campo("Custo por mil pontos", Number(maquina.custoPorMilPontos), custoPorMilPontos);
  diff.campo(
    "Taxa de digitalização de matriz",
    Number(maquina.custoMatrizDigitalizacao),
    custoMatrizDigitalizacao
  );
  diff.campo("Número de cabeças", maquina.cabecas, cabecas);
  diff.campo(
    "Custo por hora de máquina",
    maquina.custoHoraMaq !== null ? Number(maquina.custoHoraMaq) : null,
    custoHoraMaq
  );
  diff.campo("Custo mínimo do job", maquina.custoMinimo !== null ? Number(maquina.custoMinimo) : null, custoMinimo);
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_maquina_bordado",
      entidade: "MaquinaBordado",
      entidadeId: maquinaId,
      descricao: `Máquina de bordado "${maquina.nome}" atualizada`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/maquinas/bordado/${maquinaId}`);
  revalidatePath("/configuracoes/maquinas");
  return { ok: true, mensagem: "Máquina salva com sucesso!" };
}

export async function excluirMaquinaBordado(
  _estadoAnterior: SalvarMaquinaBordadoResult | null,
  formData: FormData
): Promise<SalvarMaquinaBordadoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaBordado.findFirst({
    where: { id: maquinaId, graficaId: usuario.graficaId },
  });
  if (!maquina) {
    return { ok: false, mensagem: "Máquina não encontrada." };
  }

  try {
    await prisma.maquinaBordado.delete({ where: { id: maquinaId } });
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
    acao: "configuracoes.excluir_maquina_bordado",
    entidade: "MaquinaBordado",
    entidadeId: maquinaId,
    descricao: `Máquina de bordado "${maquina.nome}" excluída`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect("/configuracoes/maquinas");
}
