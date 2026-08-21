-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "duplicadoDeId" TEXT;

-- CreateIndex
CREATE INDEX "orcamentos_duplicadoDeId_idx" ON "orcamentos"("duplicadoDeId");

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_duplicadoDeId_fkey" FOREIGN KEY ("duplicadoDeId") REFERENCES "orcamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
