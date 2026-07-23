import { Prisma } from "@/generated/prisma/client";

// Sob isolamento Serializable, duas transações concorrentes que leem/escrevem
// o mesmo registro não conseguem as duas commitar: o Postgres aborta uma
// delas com erro de conflito de serialização (SQLSTATE 40001). Detectar isso
// permite converter num erro amigável ("tente de novo") em vez de deixar
// subir como erro 500 genérico. Compartilhado entre todo fluxo que usa
// Serializable (ver src/app/orcamento/[id]/actions.ts,
// src/app/producao/actions.ts, src/lib/auth/rate-limit.ts).
//
// Duas formas de detectar, confirmadas empiricamente contra o banco de
// verdade (não só documentação): com o client engine clássico, o Prisma
// normaliza pra PrismaClientKnownRequestError código P2034. Mas com
// @prisma/adapter-pg (o driver adapter que este projeto usa, ver
// src/lib/prisma.ts), o conflito chega como um DriverAdapterError cru
// (kind: "TransactionWriteConflict", vindo do SQLSTATE 40001 do Postgres)
// SEM passar por essa normalização — checar só P2034 deixa esse erro
// escapar como 500 não tratado. `isDriverAdapterError` não é importado
// direto de @prisma/driver-adapter-utils porque é dependência transitiva
// (não declarada em package.json, só @prisma/adapter-pg é), então o shape
// é checado por duck typing em vez de depender do pacote indireto.
export function ehConflitoDeSerializacao(erro: unknown): boolean {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2034") {
    return true;
  }
  if (
    typeof erro === "object" &&
    erro !== null &&
    (erro as { name?: unknown }).name === "DriverAdapterError" &&
    (erro as { cause?: { kind?: unknown } }).cause?.kind === "TransactionWriteConflict"
  ) {
    return true;
  }
  return false;
}

// Violação de constraint @@unique (ex: duas requisições concorrentes tentando
// criar a mesma ocorrência de despesa recorrente pro mesmo mês). Útil pra
// tratar "outra requisição já criou isso" como sucesso silencioso em vez de
// erro 500, sem precisar de Serializable pra esse caso mais simples.
export function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}
