-- CreateTable
CREATE TABLE "pergunta_assistente_log" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pergunta_assistente_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pergunta_assistente_log_usuarioId_createdAt_idx" ON "pergunta_assistente_log"("usuarioId", "createdAt");

-- CreateIndex
CREATE INDEX "pergunta_assistente_log_graficaId_createdAt_idx" ON "pergunta_assistente_log"("graficaId", "createdAt");
