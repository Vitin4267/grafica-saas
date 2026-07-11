-- CreateTable
CREATE TABLE "tentativas_registro" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_registro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tentativas_registro_ip_createdAt_idx" ON "tentativas_registro"("ip", "createdAt");
