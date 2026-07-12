-- CreateTable
CREATE TABLE "automacao_grafica" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automacao_grafica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automacao_grafica_graficaId_key" ON "automacao_grafica"("graficaId");

-- AddForeignKey
ALTER TABLE "automacao_grafica" ADD CONSTRAINT "automacao_grafica_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
