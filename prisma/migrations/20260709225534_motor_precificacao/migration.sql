-- CreateEnum
CREATE TYPE "ModeloCalculo" AS ENUM ('SIMPLES', 'M2', 'OFFSET');

-- CreateEnum
CREATE TYPE "BaseCobranca" AS ENUM ('UNIDADE', 'M2', 'FOLHA_IMPRESSA', 'METRO_LINEAR', 'FIXO', 'HORA');

-- CreateEnum
CREATE TYPE "EstagioAcabamento" AS ENUM ('PRE_REFILE', 'POS_REFILE');

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "areaMinimaFaturavel" DECIMAL(8,4),
ADD COLUMN     "custoImpressaoM2" DECIMAL(12,4),
ADD COLUMN     "gramaturaGm2" DECIMAL(6,1),
ADD COLUMN     "modeloCalculo" "ModeloCalculo" NOT NULL DEFAULT 'SIMPLES',
ADD COLUMN     "precoPorKg" DECIMAL(12,4),
ADD COLUMN     "viraFolha" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN     "breakdown" JSONB,
ADD COLUMN     "corFrente" INTEGER,
ADD COLUMN     "corVerso" INTEGER,
ADD COLUMN     "modeloCalculo" "ModeloCalculo" NOT NULL DEFAULT 'SIMPLES';

-- CreateTable
CREATE TABLE "parametros_grafica" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "overheadPercent" DECIMAL(5,4) NOT NULL DEFAULT 0.15,
    "margemPadrao" DECIMAL(5,4) NOT NULL DEFAULT 0.20,
    "impostoPercent" DECIMAL(5,4) NOT NULL DEFAULT 0.06,
    "comissaoPercent" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "taxaFinanceiraPercent" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "pedidoMinimo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "incrementoArredondamento" DECIMAL(6,2) NOT NULL DEFAULT 0.10,
    "custoHoraMaq" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "torres" INTEGER NOT NULL DEFAULT 4,
    "custoChapa" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "folhasAcerto" INTEGER NOT NULL DEFAULT 150,
    "tempoAcertoH" DECIMAL(6,4) NOT NULL DEFAULT 0.5,
    "custoMilheiroRod" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "rodagemMinima" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "perdaPercentPadrao" DECIMAL(5,4) NOT NULL DEFAULT 0.03,
    "margemSegurancaPadrao" DECIMAL(5,4) NOT NULL DEFAULT 0.02,
    "gapPecasPadrao" DECIMAL(5,4) NOT NULL DEFAULT 0.008,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_grafica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bobinas_material" (
    "id" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "larguraNominal" DECIMAL(6,3) NOT NULL,
    "refile" DECIMAL(6,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bobinas_material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formatos_folha" (
    "id" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "larguraFolha" DECIMAL(6,3) NOT NULL,
    "alturaFolha" DECIMAL(6,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formatos_folha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes_acabamento" (
    "id" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "baseCobranca" "BaseCobranca" NOT NULL,
    "estagio" "EstagioAcabamento" NOT NULL,
    "custoSetup" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "custoMinimo" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "custoFerramental" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_acabamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_item_acabamentos" (
    "id" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "qtdBase" DECIMAL(12,4) NOT NULL,
    "custoCalculado" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "orcamento_item_acabamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parametros_grafica_graficaId_key" ON "parametros_grafica"("graficaId");

-- CreateIndex
CREATE INDEX "bobinas_material_itemGraficaId_idx" ON "bobinas_material"("itemGraficaId");

-- CreateIndex
CREATE INDEX "formatos_folha_itemGraficaId_idx" ON "formatos_folha"("itemGraficaId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_acabamento_itemGraficaId_key" ON "configuracoes_acabamento"("itemGraficaId");

-- CreateIndex
CREATE INDEX "orcamento_item_acabamentos_orcamentoItemId_idx" ON "orcamento_item_acabamentos"("orcamentoItemId");

-- AddForeignKey
ALTER TABLE "parametros_grafica" ADD CONSTRAINT "parametros_grafica_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bobinas_material" ADD CONSTRAINT "bobinas_material_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formatos_folha" ADD CONSTRAINT "formatos_folha_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_acabamento" ADD CONSTRAINT "configuracoes_acabamento_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_acabamentos" ADD CONSTRAINT "orcamento_item_acabamentos_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_acabamentos" ADD CONSTRAINT "orcamento_item_acabamentos_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
