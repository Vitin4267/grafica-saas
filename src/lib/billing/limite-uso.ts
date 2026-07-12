// Puro (sem "server-only", sem Prisma) — testável isolado, mesmo padrão de
// src/lib/estoque-critico.ts.
export const DIAS_TOLERANCIA_LIMITE = 15;

export type UsoAtual = { orcamentosMes: number; usuarios: number };
export type LimitePlano = { limiteOrcamentosMes: number | null; limiteUsuarios: number | null };

// null em qualquer limite = ilimitado, nunca excede por aquele eixo.
export function limiteExcedido(uso: UsoAtual, limite: LimitePlano): boolean {
  if (limite.limiteOrcamentosMes !== null && uso.orcamentosMes > limite.limiteOrcamentosMes) {
    return true;
  }
  if (limite.limiteUsuarios !== null && uso.usuarios > limite.limiteUsuarios) {
    return true;
  }
  return false;
}

// Decide se já passou a janela de tolerância (DIAS_TOLERANCIA_LIMITE dias
// desde que o excesso foi detectado pela primeira vez). null = nunca
// detectado excesso, nunca bloqueia.
export function deveBloquearPorLimite(
  limiteExcedidoDesde: Date | null,
  agora: Date = new Date()
): boolean {
  if (!limiteExcedidoDesde) return false;
  const prazo = new Date(limiteExcedidoDesde);
  prazo.setUTCDate(prazo.getUTCDate() + DIAS_TOLERANCIA_LIMITE);
  return agora >= prazo;
}
