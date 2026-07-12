-- DropForeignKey
ALTER TABLE "movimentacoes_estoque" DROP CONSTRAINT "movimentacoes_estoque_itemGraficaId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "clientes_graficaId_documento_key" ON "clientes"("graficaId", "documento");

-- CreateIndex
CREATE UNIQUE INDEX "despesas_serieRecorrenciaId_vencimento_key" ON "despesas"("serieRecorrenciaId", "vencimento");

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

