-- CreateTable
CREATE TABLE "assistente_grafica" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistente_grafica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistente_grafica_graficaId_key" ON "assistente_grafica"("graficaId");

-- AddForeignKey
ALTER TABLE "assistente_grafica" ADD CONSTRAINT "assistente_grafica_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
