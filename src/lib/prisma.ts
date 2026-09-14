import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { conferirIsolamentoTenant } from "@/lib/prisma-tenant-guard";

function criarClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

  // Timeouts default do Prisma pra transações interativas ($transaction com
  // callback) são maxWait: 2000ms e timeout: 5000ms — curtos demais aqui:
  // maxWait conta até o tempo de acordar a conexão com o Neon depois de
  // cold start, e o timeout de 5s pode estourar numa transição de status de
  // pedido GRANDE (baixa de estoque de muitos itens) mesmo sem cold start.
  // Valores mais generosos evitam falso positivo de timeout nesses casos
  // legítimos, sem comprometer a detecção de conflito de serialização real
  // (que independe desses timeouts). prisma.config.ts não define nada
  // equivalente — datasource/migrations só, sem transactionOptions.
  const base = new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: 5000,
      timeout: 15000,
    },
  });

  // Achado da auditoria de segurança (2026-09-13) — Fase A do isolamento à
  // prova de falhas (ver src/lib/prisma-tenant-guard.ts pro porquê/escopo
  // exato). `$extends` se aplica também DENTRO de `$transaction` (a `tx`
  // que os call sites recebem já é extendida) — confirmado empiricamente
  // antes de aceitar isso como verdade, não só documentação do Prisma.
  return base.$extends({
    name: "isolamento-tenant",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          conferirIsolamentoTenant({ model, operation, args });
          return query(args);
        },
      },
    },
  });
}

type PrismaClientExtendido = ReturnType<typeof criarClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientExtendido | undefined;
};

export const prisma: PrismaClientExtendido = globalForPrisma.prisma ?? criarClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Achado da auditoria de segurança (2026-09-13) — o `tx` que
// `prisma.$transaction(async (tx) => ...)` entrega depois do `$extends`
// acima NÃO é estruturalmente igual a `Prisma.TransactionClient` (o tipo
// gerado, baseado no client SEM extensão) — TypeScript recusa a
// atribuição em qualquer função tipada como `tx: Prisma.TransactionClient`
// (padrão usado em ~17 arquivos deste repo pra composição dentro de
// transação). Esta é a correção documentada do próprio Prisma pra client
// estendido: derivar o tipo do `$transaction` REAL em vez de usar o tipo
// genérico — toda função que recebia `Prisma.TransactionClient` passa a
// receber este `PrismaTransactionClient`.
export type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
