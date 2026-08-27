"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { dataInputParaUTC, formatoData } from "@/lib/data";

export type SalvarFeriadoResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar configurações.";

// Cria um feriado — achado A2 da Parte 6 da auditoria de abrangência
// (2026-08-27): cada gráfica tem seu próprio calendário municipal/estadual
// (ver comentário de ParametrosGrafica.prazoEmDiasUteis no schema), então
// isto é sempre um cadastro manual da gráfica, nunca um calendário nacional
// único embutido no código (exceto o ponto de partida sugerido — ver
// garantirFeriadosNacionaisPadrao em src/lib/dias-uteis.ts).
export async function criarFeriado(
  _estadoAnterior: SalvarFeriadoResult | null,
  formData: FormData
): Promise<SalvarFeriadoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const dataBruta = String(formData.get("data") || "");
  if (!dataBruta) {
    return { ok: false, mensagem: "Informe a data do feriado." };
  }
  const data = dataInputParaUTC(dataBruta);
  if (Number.isNaN(data.getTime())) {
    return { ok: false, mensagem: "Data inválida." };
  }

  const descricao = String(formData.get("descricao") || "").trim().slice(0, 200);
  if (!descricao) {
    return { ok: false, mensagem: "Informe uma descrição para o feriado." };
  }

  const recorrenteAnual = formData.get("recorrenteAnual") === "on";

  let feriado: { id: string };
  try {
    feriado = await prisma.feriadoGrafica.create({
      data: { graficaId: usuario.graficaId, data, descricao, recorrenteAnual },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return { ok: false, mensagem: "Já existe um feriado cadastrado nessa data." };
    }
    throw erro;
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.criar_feriado",
    entidade: "FeriadoGrafica",
    entidadeId: feriado.id,
    descricao: `Feriado "${descricao}" (${formatoData.format(data)}) cadastrado`,
  });

  revalidatePath("/configuracoes/feriados");
  return { ok: true, mensagem: "Feriado cadastrado." };
}

// Remove um feriado — sem "ativa/inativa" como CategoriaCusto: nada
// referencia FeriadoGrafica por FK, então excluir de verdade é seguro e
// mais simples que um soft-delete pra um calendário que a gráfica edita à
// vontade.
export async function removerFeriado(
  _estadoAnterior: SalvarFeriadoResult | null,
  formData: FormData
): Promise<SalvarFeriadoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const feriadoId = String(formData.get("feriadoId"));
  const feriado = await prisma.feriadoGrafica.findFirst({
    where: { id: feriadoId, graficaId: usuario.graficaId },
  });
  if (!feriado) {
    return { ok: false, mensagem: "Feriado não encontrado." };
  }

  await prisma.feriadoGrafica.delete({ where: { id: feriadoId } });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.remover_feriado",
    entidade: "FeriadoGrafica",
    entidadeId: feriadoId,
    descricao: `Feriado "${feriado.descricao}" (${formatoData.format(feriado.data)}) removido`,
  });

  revalidatePath("/configuracoes/feriados");
  return { ok: true, mensagem: "Feriado removido." };
}
