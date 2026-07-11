-- CreateEnum
CREATE TYPE "StatusDespesa" AS ENUM ('PENDENTE', 'PAGA');

-- CreateTable
CREATE TABLE "despesas" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" "StatusDespesa" NOT NULL DEFAULT 'PENDENTE',
    "formaPagamento" "FormaPagamento",
    "pagoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "despesas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "despesas_graficaId_idx" ON "despesas"("graficaId");

-- CreateIndex
CREATE INDEX "despesas_graficaId_status_vencimento_idx" ON "despesas"("graficaId", "status", "vencimento");

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
