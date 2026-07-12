-- CreateTable
CREATE TABLE "tokens_reset_senha" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_reset_senha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tentativas_reset_senha" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_reset_senha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tokens_reset_senha_tokenHash_key" ON "tokens_reset_senha"("tokenHash");

-- CreateIndex
CREATE INDEX "tokens_reset_senha_usuarioId_idx" ON "tokens_reset_senha"("usuarioId");

-- CreateIndex
CREATE INDEX "tentativas_reset_senha_email_createdAt_idx" ON "tentativas_reset_senha"("email", "createdAt");

-- CreateIndex
CREATE INDEX "tentativas_reset_senha_ip_createdAt_idx" ON "tentativas_reset_senha"("ip", "createdAt");

-- AddForeignKey
ALTER TABLE "tokens_reset_senha" ADD CONSTRAINT "tokens_reset_senha_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

