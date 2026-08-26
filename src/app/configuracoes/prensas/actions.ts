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

export type SalvarPrensaResult = { ok: boolean; mensagem: string };

const CAMPOS_DECIMAL = [
  "custoHoraMaq",
  "custoChapa",
  "tempoAcertoH",
  "custoMilheiroRod",
  "rodagemMinima",
  "perdaPercentPadrao",
] as const;

const CAMPOS_INTEIRO = ["torres", "folhasAcerto"] as const;

// Rótulo legível pro log de auditoria — chaves batem com CAMPOS_DECIMAL/
// CAMPOS_INTEIRO acima, então um único loop cobre os dois grupos.
const ROTULO_CAMPO_PRENSA: Record<(typeof CAMPOS_DECIMAL)[number] | (typeof CAMPOS_INTEIRO)[number], string> = {
  custoHoraMaq: "Custo hora-máquina",
  custoChapa: "Custo da chapa",
  tempoAcertoH: "Tempo de acerto (h)",
  custoMilheiroRod: "Custo do milheiro de rodagem",
  rodagemMinima: "Rodagem mínima",
  perdaPercentPadrao: "Perda padrão (%)",
  torres: "Torres",
  folhasAcerto: "Folhas de acerto",
};

export async function criarPrensa(
  _estadoAnterior: SalvarPrensaResult | null,
  formData: FormData
): Promise<SalvarPrensaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a prensa." };
  }

  let novaPrensa: { id: string };
  try {
    novaPrensa = await prisma.prensa.create({
      data: { graficaId: usuario.graficaId, nome },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma prensa com esse nome." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_prensa",
    entidade: "Prensa",
    entidadeId: novaPrensa.id,
    descricao: `Prensa "${nome}" criada`,
  });

  revalidatePath("/configuracoes/prensas");
  redirect(`/configuracoes/prensas/${novaPrensa.id}`);
}

export async function salvarPrensa(
  _estadoAnterior: SalvarPrensaResult | null,
  formData: FormData
): Promise<SalvarPrensaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const prensaId = String(formData.get("prensaId"));

  const prensa = await prisma.prensa.findFirst({
    where: { id: prensaId, graficaId: usuario.graficaId },
  });
  if (!prensa) {
    return { ok: false, mensagem: "Prensa não encontrada." };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) {
    return { ok: false, mensagem: "Informe um nome para a prensa." };
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
    await prisma.prensa.update({
      where: { id: prensaId },
      data: { nome, ativa, ...dados },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe uma prensa com esse nome." };
    }
    throw erro;
  }

  // Diff campo-a-campo: custoHoraMaq/custoChapa/etc são entrada direta do
  // motor de preço OFFSET — mudar um deles muda todo orçamento futuro (ver
  // achado A3 da auditoria de abrangência, 2026-08-24).
  const diff = criarDiffCampos();
  diff.campo("Nome", prensa.nome, nome);
  diff.campo("Ativa", prensa.ativa, ativa);
  for (const campo of [...CAMPOS_DECIMAL, ...CAMPOS_INTEIRO] as const) {
    diff.campo(ROTULO_CAMPO_PRENSA[campo], Number(prensa[campo]), dados[campo]);
  }
  if (diff.temMudanca) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_prensa",
      entidade: "Prensa",
      entidadeId: prensaId,
      descricao: `Prensa "${prensa.nome}" atualizada`,
      valorAnterior: diff.antesTextos.join("; "),
      valorNovo: diff.depoisTextos.join("; "),
    });
  }

  revalidatePath(`/configuracoes/prensas/${prensaId}`);
  revalidatePath("/configuracoes/prensas");
  return { ok: true, mensagem: "Prensa salva com sucesso!" };
}

export async function excluirPrensa(
  _estadoAnterior: SalvarPrensaResult | null,
  formData: FormData
): Promise<SalvarPrensaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }
  const prensaId = String(formData.get("prensaId"));

  const prensa = await prisma.prensa.findFirst({
    where: { id: prensaId, graficaId: usuario.graficaId },
  });
  if (!prensa) {
    return { ok: false, mensagem: "Prensa não encontrada." };
  }

  try {
    await prisma.prensa.delete({ where: { id: prensaId } });
  } catch (erro) {
    if (ehViolacaoDeChaveEstrangeira(erro)) {
      return {
        ok: false,
        mensagem:
          "Esta prensa está em uso por produtos do catálogo — troque a prensa desses produtos antes de excluir.",
      };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.excluir_prensa",
    entidade: "Prensa",
    entidadeId: prensaId,
    descricao: `Prensa "${prensa.nome}" excluída`,
  });

  revalidatePath("/configuracoes/prensas");
  redirect("/configuracoes/prensas");
}
