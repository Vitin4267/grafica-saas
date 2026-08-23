-- CreateEnum
CREATE TYPE "ProcessoSetupPorPeca" AS ENUM ('SERIGRAFIA', 'SUBLIMACAO', 'ESTAMPAGEM_QUENTE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModeloCalculo" ADD VALUE 'DIGITAL';
ALTER TYPE "ModeloCalculo" ADD VALUE 'SERIGRAFIA';
ALTER TYPE "ModeloCalculo" ADD VALUE 'SUBLIMACAO';
ALTER TYPE "ModeloCalculo" ADD VALUE 'ESTAMPAGEM_QUENTE';

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "impressoraDigitalId" TEXT,
ADD COLUMN     "maquinaSetupPorPecaId" TEXT;

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN     "numeroCliques" INTEGER,
ADD COLUMN     "numeroSetups" INTEGER;

-- AlterTable
ALTER TABLE "registros_manutencao" ADD COLUMN     "impressoraDigitalId" TEXT,
ADD COLUMN     "maquinaSetupPorPecaId" TEXT;

-- CreateTable
CREATE TABLE "impressoras_digitais" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "custoPorClique" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "impressoras_digitais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maquinas_setup_por_peca" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipoProcesso" "ProcessoSetupPorPeca" NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "custoPorSetup" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "custoPorPeca" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "custoMinimo" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maquinas_setup_por_peca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impressoras_digitais_graficaId_idx" ON "impressoras_digitais"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "impressoras_digitais_graficaId_nome_key" ON "impressoras_digitais"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "maquinas_setup_por_peca_graficaId_idx" ON "maquinas_setup_por_peca"("graficaId");

-- CreateIndex
CREATE INDEX "maquinas_setup_por_peca_tipoProcesso_idx" ON "maquinas_setup_por_peca"("tipoProcesso");

-- CreateIndex
CREATE UNIQUE INDEX "maquinas_setup_por_peca_graficaId_nome_key" ON "maquinas_setup_por_peca"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "itens_grafica_impressoraDigitalId_idx" ON "itens_grafica"("impressoraDigitalId");

-- CreateIndex
CREATE INDEX "itens_grafica_maquinaSetupPorPecaId_idx" ON "itens_grafica"("maquinaSetupPorPecaId");

-- CreateIndex
CREATE INDEX "registros_manutencao_impressoraDigitalId_idx" ON "registros_manutencao"("impressoraDigitalId");

-- CreateIndex
CREATE INDEX "registros_manutencao_maquinaSetupPorPecaId_idx" ON "registros_manutencao"("maquinaSetupPorPecaId");

-- AddForeignKey
ALTER TABLE "impressoras_digitais" ADD CONSTRAINT "impressoras_digitais_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maquinas_setup_por_peca" ADD CONSTRAINT "maquinas_setup_por_peca_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_manutencao" ADD CONSTRAINT "registros_manutencao_impressoraDigitalId_fkey" FOREIGN KEY ("impressoraDigitalId") REFERENCES "impressoras_digitais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_manutencao" ADD CONSTRAINT "registros_manutencao_maquinaSetupPorPecaId_fkey" FOREIGN KEY ("maquinaSetupPorPecaId") REFERENCES "maquinas_setup_por_peca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_impressoraDigitalId_fkey" FOREIGN KEY ("impressoraDigitalId") REFERENCES "impressoras_digitais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_maquinaSetupPorPecaId_fkey" FOREIGN KEY ("maquinaSetupPorPecaId") REFERENCES "maquinas_setup_por_peca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
