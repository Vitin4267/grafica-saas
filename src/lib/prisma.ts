import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

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
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: 5000,
      timeout: 15000,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
