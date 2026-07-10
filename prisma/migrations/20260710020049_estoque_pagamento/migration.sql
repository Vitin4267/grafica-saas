-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO', 'BOLETO', 'TRANSFERENCIA', 'OUTRO');

-- CreateTable
CREATE TABLE "ficha_tecnica_itens" (
    "id" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "materiaPrimaId" TEXT NOT NULL,
    "quantidadePorUnidade" DECIMAL(12,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ficha_tecnica_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ficha_tecnica_itens_itemGraficaId_idx" ON "ficha_tecnica_itens"("itemGraficaId");

-- CreateIndex
CREATE INDEX "ficha_tecnica_itens_materiaPrimaId_idx" ON "ficha_tecnica_itens"("materiaPrimaId");

-- CreateIndex
CREATE UNIQUE INDEX "ficha_tecnica_itens_itemGraficaId_materiaPrimaId_key" ON "ficha_tecnica_itens"("itemGraficaId", "materiaPrimaId");

-- CreateIndex
CREATE INDEX "pagamentos_orcamentoId_idx" ON "pagamentos"("orcamentoId");

-- AddForeignKey
ALTER TABLE "ficha_tecnica_itens" ADD CONSTRAINT "ficha_tecnica_itens_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ficha_tecnica_itens" ADD CONSTRAINT "ficha_tecnica_itens_materiaPrimaId_fkey" FOREIGN KEY ("materiaPrimaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
