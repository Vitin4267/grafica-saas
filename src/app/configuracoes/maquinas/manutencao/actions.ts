"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { validarSelecaoMaquina } from "@/lib/manutencao-maquina";
import type { TipoRegistroManutencao } from "@/generated/prisma/enums";
import { registrarAuditoria } from "@/lib/auditoria";

export type SalvarManutencaoResult = { ok: boolean; mensagem: string };

const TIPOS_VALIDOS: TipoRegistroManutencao[] = ["PREVENTIVA", "QUEBRA"];
const ROTULO_TIPO_MANUTENCAO: Record<TipoRegistroManutencao, string> = {
  PREVENTIVA: "Preventiva",
  QUEBRA: "Quebra",
};

function revalidarTelas() {
  revalidatePath("/configuracoes/maquinas");
  revalidatePath("/configuracoes/maquinas/manutencao");
  // O catálogo mostra o aviso de "máquina parada" no cadastro de produto —
  // sem revalidar aqui, quem já estivesse com a tela de produto aberta veria
  // o aviso desatualizado até navegar de novo.
  revalidatePath("/catalogo", "layout");
}

// Os 5 campos possíveis (generalizado na Feature A: eram 3 — prensa, flexo,
// equipamento — agora + impressora digital e máquina de setup-por-peça).
// Cada entrada sabe validar que o id existe na gráfica — uma função só,
// reaproveitada tanto pra checar existência quanto pra montar o `data` do
// create abaixo, em vez de duplicar o if/else por campo.
const CAMPOS_MAQUINA = [
  {
    campo: "prensaId",
    rotulo: "Prensa",
    existe: (id: string, graficaId: string) =>
      prisma.prensa.findFirst({ where: { id, graficaId } }),
  },
  {
    campo: "maquinaFlexografiaId",
    rotulo: "Máquina de flexografia",
    existe: (id: string, graficaId: string) =>
      prisma.maquinaFlexografia.findFirst({ where: { id, graficaId } }),
  },
  {
    campo: "equipamentoId",
    rotulo: "Equipamento",
    existe: (id: string, graficaId: string) =>
      prisma.equipamento.findFirst({ where: { id, graficaId } }),
  },
  {
    campo: "impressoraDigitalId",
    rotulo: "Impressora digital",
    existe: (id: string, graficaId: string) =>
      prisma.impressoraDigital.findFirst({ where: { id, graficaId } }),
  },
  {
    campo: "maquinaSetupPorPecaId",
    rotulo: "Máquina",
    existe: (id: string, graficaId: string) =>
      prisma.maquinaSetupPorPeca.findFirst({ where: { id, graficaId } }),
  },
] as const;

// Registra o INÍCIO de uma parada (preventiva ou quebra) numa das 5 máquinas
// possíveis — exatamente uma, nunca mais de uma (ver validarSelecaoMaquina).
// Bloqueia se a máquina já tiver uma parada ativa (dataFim null): evitar duas
// linhas "em andamento" simultâneas pra mesma máquina, o que quebraria a
// premissa de indexarManutencoesAtivasPorMaquina (no máximo 1 registro ativo
// por máquina).
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

  const idsPorCampo = CAMPOS_MAQUINA.map(({ campo }) => String(formData.get(campo) ?? "").trim());
  const validacao = validarSelecaoMaquina(idsPorCampo);
  if (!validacao.ok) {
    return { ok: false, mensagem: validacao.mensagem };
  }
  const indiceEscolhido = idsPorCampo.findIndex((v) => v.length > 0);
  const { campo, rotulo, existe } = CAMPOS_MAQUINA[indiceEscolhido];
  const idEscolhido = idsPorCampo[indiceEscolhido];

  const tipo = String(formData.get("tipo") ?? "");
  if (!TIPOS_VALIDOS.includes(tipo as TipoRegistroManutencao)) {
    return { ok: false, mensagem: "Selecione o tipo de parada." };
  }

  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) {
    return { ok: false, mensagem: "Descreva o motivo da parada." };
  }

  const maquina = await existe(idEscolhido, usuario.graficaId);
  if (!maquina) {
    return { ok: false, mensagem: `${rotulo} não encontrada.` };
  }

  const jaAtiva = await prisma.registroManutencao.findFirst({
    where: { graficaId: usuario.graficaId, dataFim: null, [campo]: idEscolhido },
  });
  if (jaAtiva) {
    return {
      ok: false,
      mensagem: "Esta máquina já está com uma parada em andamento — encerre a atual antes de registrar outra.",
    };
  }

  const registro = await prisma.registroManutencao.create({
    data: {
      graficaId: usuario.graficaId,
      [campo]: idEscolhido,
      tipo: tipo as TipoRegistroManutencao,
      motivo,
      registradoPorId: usuario.id,
    },
  });

  // Parada de máquina afeta disponibilidade pro motor de precificação (ver
  // aviso "máquina parada" no catálogo) — vale rastro de quem registrou.
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.iniciar_manutencao",
    entidade: "RegistroManutencao",
    entidadeId: registro.id,
    descricao: `Parada (${ROTULO_TIPO_MANUTENCAO[tipo as TipoRegistroManutencao]}) iniciada em "${maquina.nome}" — ${rotulo}: ${motivo}`,
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

  // Busca ANTES do updateMany só pra saber qual máquina/motivo citar no log
  // — a mutação em si continua sendo o updateMany filtrado abaixo
  // (TOCTOU-safe: se a parada já tiver sido encerrada por outra requisição
  // entre as duas chamadas, count fica 0 e nenhum log é gravado).
  const registroParaLog = await prisma.registroManutencao.findFirst({
    where: { id: registroId, graficaId: usuario.graficaId, dataFim: null },
  });

  const resultado = await prisma.registroManutencao.updateMany({
    where: { id: registroId, graficaId: usuario.graficaId, dataFim: null },
    data: { dataFim: new Date() },
  });

  if (resultado.count === 0) {
    return { ok: false, mensagem: "Essa parada já foi encerrada ou não existe mais." };
  }

  if (registroParaLog) {
    const campoMaquina = CAMPOS_MAQUINA.find(({ campo }) => registroParaLog[campo] != null);
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.encerrar_manutencao",
      entidade: "RegistroManutencao",
      entidadeId: registroId,
      descricao: `Parada (${ROTULO_TIPO_MANUTENCAO[registroParaLog.tipo]}) encerrada${campoMaquina ? ` — ${campoMaquina.rotulo}` : ""}`,
    });
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

  const registroParaLog = await prisma.registroManutencao.findFirst({
    where: { id: registroId, graficaId: usuario.graficaId },
  });

  const resultado = await prisma.registroManutencao.deleteMany({
    where: { id: registroId, graficaId: usuario.graficaId },
  });
  if (resultado.count === 0) {
    return { ok: false, mensagem: "Registro não encontrado." };
  }

  if (registroParaLog) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.excluir_registro_manutencao",
      entidade: "RegistroManutencao",
      entidadeId: registroId,
      descricao: `Registro de manutenção (${ROTULO_TIPO_MANUTENCAO[registroParaLog.tipo]}, motivo: ${registroParaLog.motivo}) excluído`,
    });
  }

  revalidarTelas();
  return { ok: true, mensagem: "Registro excluído." };
}
