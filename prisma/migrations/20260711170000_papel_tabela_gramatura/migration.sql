-- AlterTable
ALTER TABLE "itens_grafica" DROP COLUMN "precoPorKg",
ADD COLUMN     "papelId" TEXT;

-- CreateTable
CREATE TABLE "tabela_preco_papel" (
    "id" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "gramatura" INTEGER NOT NULL,
    "precoKg" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tabela_preco_papel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tabela_preco_papel_itemGraficaId_idx" ON "tabela_preco_papel"("itemGraficaId");

-- CreateIndex
CREATE UNIQUE INDEX "tabela_preco_papel_itemGraficaId_gramatura_key" ON "tabela_preco_papel"("itemGraficaId", "gramatura");

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_papelId_fkey" FOREIGN KEY ("papelId") REFERENCES "itens_grafica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabela_preco_papel" ADD CONSTRAINT "tabela_preco_papel_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;
