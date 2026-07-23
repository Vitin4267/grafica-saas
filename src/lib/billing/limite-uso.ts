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

const UM_DIA_MS = 24 * 60 * 60 * 1000;

// Decide se o relógio de "excedeu o limite" pode ser zerado agora que o uso
// voltou pra dentro do teto. Exige pelo menos 1 dia desde que o excesso foi
// detectado — sem essa espera, criar um orçamento extra pra cruzar o teto e
// apagá-lo em seguida (ex: um rascunho) resetava a janela de tolerância de
// 15 dias instantaneamente e de forma repetível (achado da auditoria de
// 2026-07-23). Não fecha o loophole por completo (ainda dá pra "piscar"
// abaixo do limite 1x por dia), mas limita a taxa de abuso — proporcional a
// um limite que já é soft por design.
export function deveResetarJanelaExcedente(
  limiteExcedidoDesde: Date,
  agora: Date = new Date()
): boolean {
  return agora.getTime() - limiteExcedidoDesde.getTime() >= UM_DIA_MS;
}
