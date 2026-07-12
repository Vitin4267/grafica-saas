// Puro (sem Prisma, sem "server-only") — testável isolado, mesmo padrão de
// tokenResetValido (./token-reset.ts). Código de uso único (usadoEm), mas
// com uma segunda trava que o reset de senha não precisa: tentativas.
// Um código de 6 dígitos é um espaço bem menor (1 em 1.000.000) que o
// token de 256 bits do reset de senha, então limitar quantos PALPITES
// cada código aceita é essencial — sem isso, alguém poderia tentar todas
// as combinações contra um código só, dentro da janela de 15 minutos.
export const LIMITE_TENTATIVAS = 5;

export function codigoVerificacaoValido(
  token: { expiraEm: Date; usadoEm: Date | null; tentativas: number },
  agora: Date = new Date()
): boolean {
  return token.usadoEm === null && token.expiraEm > agora && token.tentativas < LIMITE_TENTATIVAS;
}
