-- CreateEnum
CREATE TYPE "StatusEntrega" AS ENUM ('AGUARDANDO', 'EM_TRANSITO', 'ENTREGUE', 'PROBLEMA');

-- CreateTable
CREATE TABLE "entregas" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "status" "StatusEntrega" NOT NULL DEFAULT 'AGUARDANDO',
    "motorista" TEXT,
    "dataSaida" TIMESTAMP(3),
    "dataEntrega" TIMESTAMP(3),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entregas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entregas_pedidoId_key" ON "entregas"("pedidoId");

-- CreateIndex
CREATE INDEX "entregas_graficaId_idx" ON "entregas"("graficaId");

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
