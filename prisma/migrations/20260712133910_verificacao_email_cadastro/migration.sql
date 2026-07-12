-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "emailVerificadoEm" TIMESTAMP(3);

-- Backfill manual: "perdoa" toda conta que já existia antes desta feature
-- (marca como verificada na própria data de criação) — sem isso, todo
-- usuário atual ficaria bloqueado em /verificar-email no primeiro acesso
-- pós-deploy. Só cadastros feitos DEPOIS desta migração nascem com
-- emailVerificadoEm NULL de verdade (ver src/app/registro/actions.ts).
UPDATE "usuarios" SET "emailVerificadoEm" = "createdAt";

-- CreateTable
CREATE TABLE "tokens_verificacao_email" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_verificacao_email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tentativas_verificacao_email" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_verificacao_email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tokens_verificacao_email_usuarioId_idx" ON "tokens_verificacao_email"("usuarioId");

-- CreateIndex
CREATE INDEX "tentativas_verificacao_email_usuarioId_createdAt_idx" ON "tentativas_verificacao_email"("usuarioId", "createdAt");

-- CreateIndex
CREATE INDEX "tentativas_verificacao_email_ip_createdAt_idx" ON "tentativas_verificacao_email"("ip", "createdAt");

-- AddForeignKey
ALTER TABLE "tokens_verificacao_email" ADD CONSTRAINT "tokens_verificacao_email_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

