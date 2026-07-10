-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN "linkPublicoToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orcamentos_linkPublicoToken_key" ON "orcamentos"("linkPublicoToken");
