import type { TipoRegistroManutencao } from "@/generated/prisma/enums";

export const ROTULO_TIPO_MANUTENCAO: Record<TipoRegistroManutencao, string> = {
  PREVENTIVA: "Preventiva",
  QUEBRA: "Quebra/parada",
};

// Formato mínimo de um registro de manutenção pras funções puras abaixo —
// os call sites reais passam a linha inteira vinda do Prisma (que tem mais
// campos), TypeScript aceita por structural typing. 5 FKs opcionais desde a
// Feature A (Digital + os 3 de setup-por-peça) — generalização do mesmo
// padrão que já existia com prensa/flexo/equipamento.
type RegistroComMaquina = {
  prensaId: string | null;
  maquinaFlexografiaId: string | null;
  equipamentoId: string | null;
  impressoraDigitalId: string | null;
  maquinaSetupPorPecaId: string | null;
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
    const maquinaId =
      registro.prensaId ??
      registro.maquinaFlexografiaId ??
      registro.equipamentoId ??
      registro.impressoraDigitalId ??
      registro.maquinaSetupPorPecaId;
    if (maquinaId) porMaquina.set(maquinaId, registro);
  }
  return porMaquina;
}

// Exatamente um dentre os ids precisa vir preenchido — mesma regra de
// app-level (sem CHECK no banco) que ItemGrafica.prensaId/maquinaFlexografiaId
// já segue. Array em vez de 3 argumentos fixos (mudança da Feature A, que
// generalizou de 3 pra 5 máquinas possíveis) — extraída em função pura pra
// poder testar sem tocar o banco.
export function validarSelecaoMaquina(
  ids: string[]
): { ok: true } | { ok: false; mensagem: string } {
  const preenchidos = ids.filter((v) => v.trim().length > 0).length;
  if (preenchidos !== 1) {
    return {
      ok: false,
      mensagem: "Selecione exatamente uma máquina, nunca mais de uma.",
    };
  }
  return { ok: true };
}
