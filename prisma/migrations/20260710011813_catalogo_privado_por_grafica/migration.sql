-- DropIndex
DROP INDEX "itens_catalogo_tipo_nome_key";

-- AlterTable
ALTER TABLE "itens_catalogo" ADD COLUMN     "graficaId" TEXT;

-- CreateIndex
CREATE INDEX "itens_catalogo_graficaId_idx" ON "itens_catalogo"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "itens_catalogo_graficaId_tipo_nome_key" ON "itens_catalogo"("graficaId", "tipo", "nome");

-- AddForeignKey
ALTER TABLE "itens_catalogo" ADD CONSTRAINT "itens_catalogo_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
