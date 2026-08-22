-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN "qrToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_qrToken_key" ON "pedidos"("qrToken");
