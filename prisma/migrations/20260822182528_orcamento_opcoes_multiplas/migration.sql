-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN     "opcaoId" TEXT;

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "opcaoEscolhidaNome" TEXT;

-- CreateTable
CREATE TABLE "orcamento_opcoes" (
    "id" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orcamento_opcoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orcamento_opcoes_orcamentoId_idx" ON "orcamento_opcoes"("orcamentoId");

-- CreateIndex
CREATE INDEX "orcamento_itens_opcaoId_idx" ON "orcamento_itens"("opcaoId");

-- AddForeignKey
ALTER TABLE "orcamento_opcoes" ADD CONSTRAINT "orcamento_opcoes_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_opcaoId_fkey" FOREIGN KEY ("opcaoId") REFERENCES "orcamento_opcoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
