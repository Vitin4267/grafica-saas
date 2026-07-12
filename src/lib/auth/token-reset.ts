// Puro (sem Prisma, sem "server-only") — testável isolado, mesmo padrão de
// assinaturaEstaLiberada (src/lib/billing/status.ts). Token de uso único:
// já usado ou expirado nunca é válido, mesmo dentro da janela de tempo.
export function tokenResetValido(
  token: { expiraEm: Date; usadoEm: Date | null },
  agora: Date = new Date()
): boolean {
  return token.usadoEm === null && token.expiraEm > agora;
}
