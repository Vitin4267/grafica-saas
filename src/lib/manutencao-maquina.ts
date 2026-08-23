import type { TipoRegistroManutencao } from "@/generated/prisma/enums";

export const ROTULO_TIPO_MANUTENCAO: Record<TipoRegistroManutencao, string> = {
  PREVENTIVA: "Preventiva",
  QUEBRA: "Quebra/parada",
};

// Formato mínimo de um registro de manutenção pras funções puras abaixo —
// os call sites reais passam a linha inteira vinda do Prisma (que tem mais
// campos), TypeScript aceita por structural typing.
type RegistroComMaquina = {
  prensaId: string | null;
  maquinaFlexografiaId: string | null;
  equipamentoId: string | null;
};

// Índice rápido "id da máquina -> registro ativo" a partir de uma lista de
// RegistroManutencao com dataFim=null (ver query em quem chama). Uma
// gráfica pode ter várias prensas/máquinas/equipamentos; cada um tem no
// máximo 1 registro ativo por vez (garantido em iniciarManutencao, não por
// constraint de banco). Uma função só, reaproveitada tanto pro badge em
// /configuracoes/maquinas quanto pro aviso no cadastro de produto.
export function indexarManutencoesAtivasPorMaquina<T extends RegistroComMaquina>(
  registrosAtivos: T[]
): Map<string, T> {
  const porMaquina = new Map<string, T>();
  for (const registro of registrosAtivos) {
    const maquinaId = registro.prensaId ?? registro.maquinaFlexografiaId ?? registro.equipamentoId;
    if (maquinaId) porMaquina.set(maquinaId, registro);
  }
  return porMaquina;
}

// Exatamente um dos três precisa vir preenchido — mesma regra de app-level
// (sem CHECK no banco) que ItemGrafica.prensaId/maquinaFlexografiaId já
// segue, agora estendida pra Equipamento. Extraída em função pura pra poder
// testar sem tocar o banco.
export function validarSelecaoMaquina(
  prensaId: string,
  maquinaFlexografiaId: string,
  equipamentoId: string
): { ok: true } | { ok: false; mensagem: string } {
  const preenchidos = [prensaId, maquinaFlexografiaId, equipamentoId].filter(
    (v) => v.trim().length > 0
  ).length;
  if (preenchidos !== 1) {
    return {
      ok: false,
      mensagem: "Selecione exatamente uma prensa, máquina de flexografia OU equipamento, nunca mais de um.",
    };
  }
  return { ok: true };
}
