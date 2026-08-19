-- AlterEnum
ALTER TYPE "ModeloCalculo" ADD VALUE 'FLEXOGRAFIA';

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "maquinaFlexografiaId" TEXT;

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN     "numeroCoresFlexo" INTEGER;

-- CreateTable
CREATE TABLE "maquinas_flexografia" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "larguraMaquinaM" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "passoCilindroM" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "numeroEstacoesCores" INTEGER NOT NULL DEFAULT 6,
    "custoHoraMaq" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "tempoAcertoH" DECIMAL(6,4) NOT NULL DEFAULT 1,
    "metrosAcerto" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "custoMetroLinearRod" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "rodagemMinima" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "perdaPercentPadrao" DECIMAL(5,4) NOT NULL DEFAULT 0.03,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maquinas_flexografia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes_cliche_flexografia" (
    "id" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "custoClichePorCm2" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_cliche_flexografia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maquinas_flexografia_graficaId_idx" ON "maquinas_flexografia"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "maquinas_flexografia_graficaId_nome_key" ON "maquinas_flexografia"("graficaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_cliche_flexografia_itemGraficaId_key" ON "configuracoes_cliche_flexografia"("itemGraficaId");

-- AddForeignKey
ALTER TABLE "maquinas_flexografia" ADD CONSTRAINT "maquinas_flexografia_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_maquinaFlexografiaId_fkey" FOREIGN KEY ("maquinaFlexografiaId") REFERENCES "maquinas_flexografia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_cliche_flexografia" ADD CONSTRAINT "configuracoes_cliche_flexografia_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

