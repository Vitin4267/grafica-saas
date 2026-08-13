-- CreateTable
CREATE TABLE "tentativas_resposta_arte" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_resposta_arte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tentativas_resposta_arte_pedidoId_createdAt_idx" ON "tentativas_resposta_arte"("pedidoId", "createdAt");

-- CreateIndex
CREATE INDEX "tentativas_resposta_arte_ip_createdAt_idx" ON "tentativas_resposta_arte"("ip", "createdAt");
