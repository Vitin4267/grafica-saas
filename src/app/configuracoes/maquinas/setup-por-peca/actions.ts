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
import { ROTULO_PROCESSO_SETUP_POR_PECA } from "@/lib/tipos-equipamento";
import type { ProcessoSetupPorPeca } from "@/generated/prisma/enums";
import { registrarAuditoria, criarDiffCampos } from "@/lib/auditoria";

export type SalvarMaquinaSetupPorPecaResult = { ok: boolean; mensagem: string };

const CAMPOS_DECIMAL = ["custoPorSetup", "custoPorPeca", "custoMinimo"] as const;
const ROTULO_CAMPO_SETUP_POR_PECA: Record<(typeof CAMPOS_DECIMAL)[number], string> = {
  custoPorSetup: "Custo por setup",
  custoPorPeca: "Custo por peça",
  custoMinimo: "Custo mínimo",
};

// Rótulo legível pra auditoria — cai pro texto de tipoProcessoOutro quando o
// processo é o escape hatch OUTRO (mesmo padrão de exibição de
// rotuloCategoria em configuracoes/maquinas/equipamentos/actions.ts).
function rotuloProcesso(tipoProcesso: ProcessoSetupPorPeca, tipoProcessoOutro: string | null): string {
  return tipoProcesso === "OUTRO"
    ? (tipoProcessoOutro ?? "Outro")
    : ROTULO_PROCESSO_SETUP_POR_PECA[tipoProcesso];
}

// Mesmo padrão do resto do schema (CategoriaEquipamento, UnidadeMedida,
// MaterialSubstrato etc.): processo vem de uma lista fechada com OUTRO de
// escape — tipoProcessoOutro só é obrigatório nesse caso, nunca trava um
// processo real já nomeado na lista (achado A3 da auditoria de abrangência).
function validarTipoProcesso(
  formData: FormData
):
  | { ok: true; tipoProcesso: ProcessoSetupPorPeca; tipoProcessoOutro: string | null }
  | { ok: false; mensagem: string } {
  const tipoProcesso = String(formData.get("tipoProcesso") ?? "");
  if (!Object.keys(ROTULO_PROCESSO_SETUP_POR_PECA).includes(tipoProcesso)) {
    return { ok: false, mensagem: "Selecione um processo." };
  }
  if (tipoProcesso === "OUTRO") {
    const tipoProcessoOutro = String(formData.get("tipoProcessoOutro") ?? "").trim();
    if (!tipoProcessoOutro) {
      return { ok: false, mensagem: 'Descreva o processo quando escolher "Outro".' };
    }
    return { ok: true, tipoProcesso: "OUTRO", tipoProcessoOutro };
  }
  return { ok: true, tipoProcesso: tipoProcesso as ProcessoSetupPorPeca, tipoProcessoOutro: null };
}

export async function criarMaquinaSetupPorPeca(
  _estadoAnterior: SalvarMaquinaSetupPorPecaResult | null,
  formData: FormData
): Promise<SalvarMaquinaSetupPorPecaResult> {
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

  const validacaoTipo = validarTipoProcesso(formData);
  if (!validacaoTipo.ok) {
    return validacaoTipo;
  }

  let novaMaquina: { id: string };
  try {
    novaMaquina = await prisma.maquinaSetupPorPeca.create({
      data: {
        graficaId: usuario.graficaId,
        nome,
        tipoProcesso: validacaoTipo.tipoProcesso,
        tipoProcessoOutro: validacaoTipo.tipoProcessoOutro,
      },
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
    acao: "configuracoes.criar_maquina_setup_por_peca",
    entidade: "MaquinaSetupPorPeca",
    entidadeId: novaMaquina.id,
    descricao: `Máquina "${nome}" (${rotuloProcesso(validacaoTipo.tipoProcesso, validacaoTipo.tipoProcessoOutro)}) criada`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect(`/configuracoes/maquinas/setup-por-peca/${novaMaquina.id}`);
}

export async function salvarMaquinaSetupPorPeca(
  _estadoAnterior: SalvarMaquinaSetupPorPecaResult | null,
  formData: FormData
): Promise<SalvarMaquinaSetupPorPecaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaSetupPorPeca.findFirst({
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

  const validacaoTipo = validarTipoProcesso(formData);
  if (!validacaoTipo.ok) {
    return validacaoTipo;
  }

  const dados: Record<string, number> = {};
  for (const campo of CAMPOS_DECIMAL) {
    const valor = Number(formData.get(campo));
    if (!Number.isFinite(valor) || valor < 0) {
      return { ok: false, mensagem: `Valor inválido em "${campo}".` };
    }
    dados[campo] = valor;
  }

  try {
    await prisma.maquinaSetupPorPeca.update({
      where: { id: maquinaId },
      data: {
        nome,
        ativa,
        tipoProcesso: validacaoTipo.tipoProcesso,
        tipoProcessoOutro: validacaoTipo.tipoProcessoOutro,
        ...dados,
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
  diff.campo(
    "Processo",
    rotuloProcesso(maquina.tipoProcesso, maquina.tipoProcessoOutro),
    rotuloProcesso(validacaoTipo.tipoProcesso, validacaoTipo.tipoProcessoOutro)
  );
  for (const campo of CAMPOS_DECIMAL) {
    diff.campo(ROTULO_CAMPO_SETUP_POR_PECA[campo], Number(maquina[campo]), dados[campo]);
  }
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_maquina_setup_por_peca",
      entidade: "MaquinaSetupPorPeca",
      entidadeId: maquinaId,
      descricao: `Máquina "${maquina.nome}" atualizada`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/maquinas/setup-por-peca/${maquinaId}`);
  revalidatePath("/configuracoes/maquinas");
  return { ok: true, mensagem: "Máquina salva com sucesso!" };
}

export async function excluirMaquinaSetupPorPeca(
  _estadoAnterior: SalvarMaquinaSetupPorPecaResult | null,
  formData: FormData
): Promise<SalvarMaquinaSetupPorPecaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const maquinaId = String(formData.get("maquinaId"));

  const maquina = await prisma.maquinaSetupPorPeca.findFirst({
    where: { id: maquinaId, graficaId: usuario.graficaId },
  });
  if (!maquina) {
    return { ok: false, mensagem: "Máquina não encontrada." };
  }

  try {
    await prisma.maquinaSetupPorPeca.delete({ where: { id: maquinaId } });
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
    acao: "configuracoes.excluir_maquina_setup_por_peca",
    entidade: "MaquinaSetupPorPeca",
    entidadeId: maquinaId,
    descricao: `Máquina "${maquina.nome}" excluída`,
  });

  revalidatePath("/configuracoes/maquinas");
  redirect("/configuracoes/maquinas");
}
