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
  // P2028 é o código de "Transaction API error" do gerenciador de transação
  // interativa do próprio Prisma (não vem do Postgres, ao contrário do
  // P2034) — cobre tanto "Unable to start a transaction in the given time"
  // (estourou maxWait, ex: cold start do Neon) quanto a transação expirar
  // por ter passado do timeout configurado (ex: baixa de estoque de um
  // pedido GRANDE). Confirmado lendo node_modules/@prisma/client/runtime
  // (classe TransactionManagerError sempre usa code "P2028" fixo, tanto pra
  // maxWait quanto pra timeout, e essa lógica roda no runtime JS do client
  // — não depende de driver adapter, diferente do caso P2034/
  // TransactionWriteConflict acima). Tratamos igual ao P2034 porque pro
  // usuário a ação recomendada é a mesma: "tente de novo".
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2028") {
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

// Tentativa de apagar uma linha ainda referenciada por uma FK com
// onDelete:Restrict (ex: excluir Prensa/Cliente ainda em uso) — o app trata
// isso como erro amigável ("está em uso, não dá pra excluir"), nunca 500.
// Mesmo problema do comentário de ehConflitoDeSerializacao acima, confirmado
// empiricamente do mesmo jeito (script direto contra o banco, não só
// documentação): violação de RESTRICT no DELETE chega como DriverAdapterError
// cru com SQLSTATE do Postgres (23001 = restrict_violation; 23503 =
// foreign_key_violation genérico, coberto também por segurança), NUNCA
// normalizado pra PrismaClientKnownRequestError código P2003 — checar só
// P2003 (como clientes/actions.ts, configuracoes/prensas/actions.ts e
// dados-exemplo.ts faziam antes desta função existir) deixa esse erro
// escapar como 500 não tratado toda vez que a exclusão é bloqueada de
// verdade, que é exatamente o caso que o catch deveria pegar.
export function ehViolacaoDeChaveEstrangeira(erro: unknown): boolean {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2003") {
    return true;
  }
  if (
    typeof erro === "object" &&
    erro !== null &&
    (erro as { name?: unknown }).name === "DriverAdapterError" &&
    ["23001", "23503"].includes((erro as { cause?: { code?: unknown } }).cause?.code as string)
  ) {
    return true;
  }
  return false;
}
