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

export type SalvarMaquinaFlexografiaResult = { ok: boolean; mensagem: string };

const CAMPOS_DECIMAL = [
  "larguraMaquinaM",
  "passoCilindroM",
  "custoHoraMaq",
  "tempoAcertoH",
  "metrosAcerto",
  "custoMetroLinearRod",
  "rodagemMinima",
  "perdaPercentPadrao",
] as const;

const CAMPOS_INTEIRO = ["numeroEstacoesCores"] as const;

// Rótulo legível pro log de auditoria (ver achado A3 da auditoria de
// abrangência, 2026-08-24) — chaves cobrem CAMPOS_DECIMAL + CAMPOS_INTEIRO.
const ROTULO_CAMPO_FLEXO: Record<(typeof CAMPOS_DECIMAL)[number] | (typeof CAMPOS_INTEIRO)[number], string> = {
  larguraMaquinaM: "Largura da máquina (m)",
  passoCilindroM: "Passo do cilindro (m)",
  custoHoraMaq: "Custo hora-máquina",
  tempoAcertoH: "Tempo de acerto (h)",
  metrosAcerto: "Metros de acerto",
  custoMetroLinearRod: "Custo do metro linear de rodagem",
  rodagemMinima: "Rodagem mínima",
  perdaPercentPadrao: "Perda padrão (%)",
  numeroEstacoesCores: "Número de estações de cores",
};

export async function criarMaquinaFlexografia(
  _estadoAnterior: SalvarMaquinaFlexografiaResult | null,
  formData: FormData
): Promise<SalvarMaquinaFlexografiaResult> {
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
    novaMaquina = await prisma.maquinaFlexografia.create({
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
    acao: "configuracoes.criar_maquina_flexografia",
    entidade: "MaquinaFlexografia",
    entidadeId: novaMaquina.id,
    descricao: `Máquina de flexografia "${nome}" criada`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect(`/configuracoes/maquinas/flexografia/${novaMaquina.id}`);
}

export async function salvarMaquinaFlexografia(
  _estadoAnterior: SalvarMaquinaFlexografiaResult | null,
  formData: FormData
): Promise<SalvarMaquinaFlexografiaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaFlexografia.findFirst({
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

  const dados: Record<string, number> = {};
  for (const campo of CAMPOS_DECIMAL) {
    const valor = Number(formData.get(campo));
    if (!Number.isFinite(valor) || valor < 0) {
      return { ok: false, mensagem: `Valor inválido em "${campo}".` };
    }
    dados[campo] = valor;
  }
  for (const campo of CAMPOS_INTEIRO) {
    const valor = Number(formData.get(campo));
    if (!Number.isInteger(valor) || valor < 1) {
      return { ok: false, mensagem: `Valor inválido em "${campo}" — deve ser um número inteiro maior que zero.` };
    }
    dados[campo] = valor;
  }

  try {
    await prisma.maquinaFlexografia.update({
      where: { id: maquinaId },
      data: { nome, ativa, ...dados },
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
  for (const campo of [...CAMPOS_DECIMAL, ...CAMPOS_INTEIRO] as const) {
    diff.campo(ROTULO_CAMPO_FLEXO[campo], Number(maquina[campo]), dados[campo]);
  }
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_maquina_flexografia",
      entidade: "MaquinaFlexografia",
      entidadeId: maquinaId,
      descricao: `Máquina de flexografia "${maquina.nome}" atualizada`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/maquinas/flexografia/${maquinaId}`);
  revalidatePath("/configuracoes/maquinas");
  return { ok: true, mensagem: "Máquina salva com sucesso!" };
}

export async function excluirMaquinaFlexografia(
  _estadoAnterior: SalvarMaquinaFlexografiaResult | null,
  formData: FormData
): Promise<SalvarMaquinaFlexografiaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaFlexografia.findFirst({
    where: { id: maquinaId, graficaId: usuario.graficaId },
  });
  if (!maquina) {
    return { ok: false, mensagem: "Máquina não encontrada." };
  }

  try {
    await prisma.maquinaFlexografia.delete({ where: { id: maquinaId } });
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
    acao: "configuracoes.excluir_maquina_flexografia",
    entidade: "MaquinaFlexografia",
    entidadeId: maquinaId,
    descricao: `Máquina de flexografia "${maquina.nome}" excluída`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect("/configuracoes/maquinas");
}
