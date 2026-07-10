import type { Algorithm } from "@node-rs/argon2";
import { hash, verify } from "@node-rs/argon2";

// Algorithm é um const enum; referenciar Algorithm.Argon2id direto quebra com
// isolatedModules (TS2748), então usamos o valor literal (2 = Argon2id) tipado.
const ARGON2ID: Algorithm = 2;

// Custo acima do padrão da lib (19 MiB) para dificultar ataques de força bruta offline
// caso o banco vaze, mantendo o tempo de verificação aceitável em produção.
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

export function hashPassword(senha: string): Promise<string> {
  return hash(senha, ARGON2_OPTIONS);
}

export function verifyPassword(
  senhaHash: string,
  senha: string
): Promise<boolean> {
  return verify(senhaHash, senha, ARGON2_OPTIONS);
}
