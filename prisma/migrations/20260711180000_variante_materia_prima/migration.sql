-- DropIndex
DROP INDEX "ficha_tecnica_itens_itemGraficaId_materiaPrimaId_key";

-- AlterTable
ALTER TABLE "ficha_tecnica_itens" ADD COLUMN     "varianteId" TEXT;

-- AlterTable
ALTER TABLE "movimentacoes_estoque" ADD COLUMN     "varianteId" TEXT;

-- CreateTable
CREATE TABLE "variantes_materia_prima" (
    "id" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "precoCompra" DECIMAL(12,4) NOT NULL,
    "estoqueAtual" DECIMAL(12,4),
    "estoqueMinimo" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variantes_materia_prima_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variantes_materia_prima_itemGraficaId_idx" ON "variantes_materia_prima"("itemGraficaId");

-- CreateIndex
CREATE UNIQUE INDEX "variantes_materia_prima_itemGraficaId_rotulo_key" ON "variantes_materia_prima"("itemGraficaId", "rotulo");

-- CreateIndex
CREATE INDEX "ficha_tecnica_itens_varianteId_idx" ON "ficha_tecnica_itens"("varianteId");

-- CreateIndex
CREATE UNIQUE INDEX "ficha_tecnica_itens_itemGraficaId_materiaPrimaId_varianteId_key" ON "ficha_tecnica_itens"("itemGraficaId", "materiaPrimaId", "varianteId");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_varianteId_idx" ON "movimentacoes_estoque"("varianteId");

-- AddForeignKey
ALTER TABLE "ficha_tecnica_itens" ADD CONSTRAINT "ficha_tecnica_itens_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "variantes_materia_prima"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variantes_materia_prima" ADD CONSTRAINT "variantes_materia_prima_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "variantes_materia_prima"("id") ON DELETE SET NULL ON UPDATE CASCADE;
