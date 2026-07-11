-- AlterTable
ALTER TABLE "movimentacoes_estoque" ADD COLUMN     "pedidoId" TEXT;

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_pedidoId_idx" ON "movimentacoes_estoque"("pedidoId");

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
