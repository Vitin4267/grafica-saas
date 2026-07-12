import { Prisma } from "@/generated/prisma/client";

// Sob isolamento Serializable, duas transações concorrentes que leem/escrevem
// o mesmo registro não conseguem as duas commitar: o Postgres aborta uma
// delas com erro de conflito de serialização (P2034). Detectar isso permite
// converter num erro amigável ("tente de novo") em vez de deixar subir como
// erro 500 genérico. Compartilhado entre todo fluxo que usa Serializable
// (ver src/app/orcamento/[id]/actions.ts, src/app/producao/actions.ts).
export function ehConflitoDeSerializacao(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2034";
}

// Violação de constraint @@unique (ex: duas requisições concorrentes tentando
// criar a mesma ocorrência de despesa recorrente pro mesmo mês). Útil pra
// tratar "outra requisição já criou isso" como sucesso silencioso em vez de
// erro 500, sem precisar de Serializable pra esse caso mais simples.
export function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}
