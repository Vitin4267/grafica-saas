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
};

// Índice rápido "id da máquina -> registro ativo" a partir de uma lista de
// RegistroManutencao com dataFim=null (ver query em quem chama). Uma
// gráfica pode ter várias prensas/máquinas; cada uma tem no máximo 1
// registro ativo por vez (garantido em iniciarManutencao, não por
// constraint de banco). Uma função só, reaproveitada tanto pro badge em
// /configuracoes/maquinas quanto pro aviso no cadastro de produto.
export function indexarManutencoesAtivasPorMaquina<T extends RegistroComMaquina>(
  registrosAtivos: T[]
): Map<string, T> {
  const porMaquina = new Map<string, T>();
  for (const registro of registrosAtivos) {
    const maquinaId = registro.prensaId ?? registro.maquinaFlexografiaId;
    if (maquinaId) porMaquina.set(maquinaId, registro);
  }
  return porMaquina;
}

// Exatamente um dos dois precisa vir preenchido — mesma regra de app-level
// (sem CHECK no banco) que ItemGrafica.prensaId/maquinaFlexografiaId já
// segue. Extraída em função pura pra poder testar sem tocar o banco.
export function validarSelecaoMaquina(
  prensaId: string,
  maquinaFlexografiaId: string
): { ok: true } | { ok: false; mensagem: string } {
  const temPrensa = prensaId.trim().length > 0;
  const temMaquina = maquinaFlexografiaId.trim().length > 0;
  if (temPrensa === temMaquina) {
    return {
      ok: false,
      mensagem: "Selecione exatamente uma prensa OU uma máquina de flexografia, nunca as duas.",
    };
  }
  return { ok: true };
}
