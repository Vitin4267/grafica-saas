"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { validarSelecaoMaquina } from "@/lib/manutencao-maquina";
import type { TipoRegistroManutencao } from "@/generated/prisma/enums";

export type SalvarManutencaoResult = { ok: boolean; mensagem: string };

const TIPOS_VALIDOS: TipoRegistroManutencao[] = ["PREVENTIVA", "QUEBRA"];

function revalidarTelas() {
  revalidatePath("/configuracoes/maquinas");
  revalidatePath("/configuracoes/maquinas/manutencao");
  // O catálogo mostra o aviso de "máquina parada" no cadastro de produto —
  // sem revalidar aqui, quem já estivesse com a tela de produto aberta veria
  // o aviso desatualizado até navegar de novo.
  revalidatePath("/catalogo", "layout");
}

// Registra o INÍCIO de uma parada (preventiva ou quebra) numa prensa ou
// máquina de flexografia — exatamente uma das duas, nunca as duas (ver
// validarSelecaoMaquina). Bloqueia se a máquina já tiver uma parada ativa
// (dataFim null): evitar duas linhas "em andamento" simultâneas pra mesma
// máquina, o que quebraria a premissa de indexarManutencoesAtivasPorMaquina
// (no máximo 1 registro ativo por máquina).
export async function iniciarManutencao(
  _estadoAnterior: SalvarManutencaoResult | null,
  formData: FormData
): Promise<SalvarManutencaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const prensaId = String(formData.get("prensaId") ?? "").trim();
  const maquinaFlexografiaId = String(formData.get("maquinaFlexografiaId") ?? "").trim();
  const equipamentoId = String(formData.get("equipamentoId") ?? "").trim();
  const validacao = validarSelecaoMaquina(prensaId, maquinaFlexografiaId, equipamentoId);
  if (!validacao.ok) {
    return { ok: false, mensagem: validacao.mensagem };
  }

  const tipo = String(formData.get("tipo") ?? "");
  if (!TIPOS_VALIDOS.includes(tipo as TipoRegistroManutencao)) {
    return { ok: false, mensagem: "Selecione o tipo de parada." };
  }

  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) {
    return { ok: false, mensagem: "Descreva o motivo da parada." };
  }

  if (prensaId) {
    const prensa = await prisma.prensa.findFirst({
      where: { id: prensaId, graficaId: usuario.graficaId },
    });
    if (!prensa) {
      return { ok: false, mensagem: "Prensa não encontrada." };
    }
  } else if (maquinaFlexografiaId) {
    const maquina = await prisma.maquinaFlexografia.findFirst({
      where: { id: maquinaFlexografiaId, graficaId: usuario.graficaId },
    });
    if (!maquina) {
      return { ok: false, mensagem: "Máquina não encontrada." };
    }
  } else {
    const equipamento = await prisma.equipamento.findFirst({
      where: { id: equipamentoId, graficaId: usuario.graficaId },
    });
    if (!equipamento) {
      return { ok: false, mensagem: "Equipamento não encontrado." };
    }
  }

  const jaAtiva = await prisma.registroManutencao.findFirst({
    where: {
      graficaId: usuario.graficaId,
      dataFim: null,
      ...(prensaId ? { prensaId } : maquinaFlexografiaId ? { maquinaFlexografiaId } : { equipamentoId }),
    },
  });
  if (jaAtiva) {
    return {
      ok: false,
      mensagem: "Esta máquina já está com uma parada em andamento — encerre a atual antes de registrar outra.",
    };
  }

  await prisma.registroManutencao.create({
    data: {
      graficaId: usuario.graficaId,
      prensaId: prensaId || null,
      maquinaFlexografiaId: maquinaFlexografiaId || null,
      equipamentoId: equipamentoId || null,
      tipo: tipo as TipoRegistroManutencao,
      motivo,
      registradoPorId: usuario.id,
    },
  });

  revalidarTelas();
  return { ok: true, mensagem: "Parada registrada." };
}

// Encerra uma parada em andamento (seta dataFim = agora). Reescopado por
// graficaId no where do updateMany (em vez de findFirst + update) — evita
// TOCTOU e, como bônus, updateMany com filtro que não bate count:0 vira
// "nada mudou" sem lançar exceção, o que já cobre o caso de alguém encerrar
// duas vezes a mesma parada (ex.: duplo clique) sem gerar erro.
export async function encerrarManutencao(
  _estadoAnterior: SalvarManutencaoResult | null,
  formData: FormData
): Promise<SalvarManutencaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const registroId = String(formData.get("registroId") ?? "");
  if (!registroId) {
    return { ok: false, mensagem: "Registro não encontrado." };
  }

  const resultado = await prisma.registroManutencao.updateMany({
    where: { id: registroId, graficaId: usuario.graficaId, dataFim: null },
    data: { dataFim: new Date() },
  });

  if (resultado.count === 0) {
    return { ok: false, mensagem: "Essa parada já foi encerrada ou não existe mais." };
  }

  revalidarTelas();
  return { ok: true, mensagem: "Parada encerrada — a máquina volta a aparecer como disponível." };
}

// Exclui um registro (corrige lançamento errado). Sem restrição de FK: nada
// referencia RegistroManutencao, então não existe o caso "está em uso" que
// as exclusões de Prensa/MaquinaFlexografia tratam.
export async function excluirRegistroManutencao(
  _estadoAnterior: SalvarManutencaoResult | null,
  formData: FormData
): Promise<SalvarManutencaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const registroId = String(formData.get("registroId") ?? "");
  const resultado = await prisma.registroManutencao.deleteMany({
    where: { id: registroId, graficaId: usuario.graficaId },
  });
  if (resultado.count === 0) {
    return { ok: false, mensagem: "Registro não encontrado." };
  }

  revalidarTelas();
  return { ok: true, mensagem: "Registro excluído." };
}
