/*
  Warnings:

  - You are about to drop the column `insumoId` on the `movimentacoes_estoque` table. All the data in the column will be lost.
  - You are about to drop the column `produtoId` on the `orcamento_itens` table. All the data in the column will be lost.
  - You are about to drop the `insumos` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `produtos` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `itemGraficaId` to the `movimentacoes_estoque` table without a default value. This is not possible if the table is not empty.
  - Added the required column `itemGraficaId` to the `orcamento_itens` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TipoItemCatalogo" AS ENUM ('PRODUTO', 'MATERIA_PRIMA', 'SERVICO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UnidadeMedida" ADD VALUE 'METRO_LINEAR';
ALTER TYPE "UnidadeMedida" ADD VALUE 'ROLO';
ALTER TYPE "UnidadeMedida" ADD VALUE 'PACOTE';
ALTER TYPE "UnidadeMedida" ADD VALUE 'CENTO';
ALTER TYPE "UnidadeMedida" ADD VALUE 'HORA';

-- DropForeignKey
ALTER TABLE "insumos" DROP CONSTRAINT "insumos_graficaId_fkey";

-- DropForeignKey
ALTER TABLE "movimentacoes_estoque" DROP CONSTRAINT "movimentacoes_estoque_insumoId_fkey";

-- DropForeignKey
ALTER TABLE "orcamento_itens" DROP CONSTRAINT "orcamento_itens_produtoId_fkey";

-- DropForeignKey
ALTER TABLE "produtos" DROP CONSTRAINT "produtos_graficaId_fkey";

-- DropIndex
DROP INDEX "movimentacoes_estoque_insumoId_idx";

-- AlterTable
ALTER TABLE "movimentacoes_estoque" DROP COLUMN "insumoId",
ADD COLUMN     "itemGraficaId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "orcamento_itens" DROP COLUMN "produtoId",
ADD COLUMN     "itemGraficaId" TEXT NOT NULL;

-- DropTable
DROP TABLE "insumos";

-- DropTable
DROP TABLE "produtos";

-- CreateTable
CREATE TABLE "itens_catalogo" (
    "id" TEXT NOT NULL,
    "tipo" "TipoItemCatalogo" NOT NULL,
    "categoria" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "unidade" "UnidadeMedida",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itens_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_grafica" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "itemCatalogoId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "precoCompra" DECIMAL(12,4),
    "precoVenda" DECIMAL(12,2),
    "estoqueAtual" DECIMAL(12,4),
    "estoqueMinimo" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_grafica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "itens_catalogo_tipo_categoria_idx" ON "itens_catalogo"("tipo", "categoria");

-- CreateIndex
CREATE UNIQUE INDEX "itens_catalogo_tipo_nome_key" ON "itens_catalogo"("tipo", "nome");

-- CreateIndex
CREATE INDEX "itens_grafica_graficaId_idx" ON "itens_grafica"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "itens_grafica_graficaId_itemCatalogoId_key" ON "itens_grafica"("graficaId", "itemCatalogoId");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_itemGraficaId_idx" ON "movimentacoes_estoque"("itemGraficaId");

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "itens_catalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
