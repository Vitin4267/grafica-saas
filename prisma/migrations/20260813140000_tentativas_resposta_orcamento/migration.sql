-- CreateTable
CREATE TABLE "tentativas_resposta_orcamento" (
    "id" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_resposta_orcamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tentativas_resposta_orcamento_orcamentoId_createdAt_idx" ON "tentativas_resposta_orcamento"("orcamentoId", "createdAt");

-- CreateIndex
CREATE INDEX "tentativas_resposta_orcamento_ip_createdAt_idx" ON "tentativas_resposta_orcamento"("ip", "createdAt");
