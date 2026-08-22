-- CreateEnum
CREATE TYPE "StatusFilaGangRun" AS ENUM ('AGUARDANDO', 'COMBINADO', 'CANCELADO');

-- AlterEnum
ALTER TYPE "OrigemCusto" ADD VALUE 'GANG_RUN';

-- CreateTable
CREATE TABLE "grupos_gang_run" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "papelId" TEXT NOT NULL,
    "gramaturaGm2" DECIMAL(6,1) NOT NULL,
    "prensaId" TEXT NOT NULL,
    "folhaId" TEXT NOT NULL,
    "corFrente" INTEGER NOT NULL,
    "corVerso" INTEGER NOT NULL,
    "custoChapasTotal" DECIMAL(12,2) NOT NULL,
    "custoSetupTotal" DECIMAL(12,2) NOT NULL,
    "combinadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "combinadoPorId" TEXT,

    CONSTRAINT "grupos_gang_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fila_gang_run" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "status" "StatusFilaGangRun" NOT NULL DEFAULT 'AGUARDANDO',
    "papelId" TEXT NOT NULL,
    "gramaturaGm2" DECIMAL(6,1) NOT NULL,
    "prensaId" TEXT NOT NULL,
    "folhaId" TEXT NOT NULL,
    "corFrente" INTEGER NOT NULL,
    "corVerso" INTEGER NOT NULL,
    "nUpPeca" INTEGER NOT NULL,
    "quantidadePeca" INTEGER NOT NULL,
    "fracaoFolha" DECIMAL(8,4) NOT NULL,
    "custoChapasIndividual" DECIMAL(12,2) NOT NULL,
    "custoSetupIndividual" DECIMAL(12,2) NOT NULL,
    "grupoGangRunId" TEXT,
    "custoRateado" DECIMAL(12,2),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceladoEm" TIMESTAMP(3),
    "motivoCancelamento" TEXT,

    CONSTRAINT "fila_gang_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grupos_gang_run_graficaId_idx" ON "grupos_gang_run"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "fila_gang_run_orcamentoItemId_key" ON "fila_gang_run"("orcamentoItemId");

-- CreateIndex
CREATE INDEX "fila_gang_run_graficaId_status_idx" ON "fila_gang_run"("graficaId", "status");

-- CreateIndex
CREATE INDEX "fila_gang_run_graficaId_papelId_gramaturaGm2_prensaId_folha_idx" ON "fila_gang_run"("graficaId", "papelId", "gramaturaGm2", "prensaId", "folhaId", "corFrente", "corVerso", "status");

-- CreateIndex
CREATE INDEX "fila_gang_run_pedidoId_idx" ON "fila_gang_run"("pedidoId");

-- AddForeignKey
ALTER TABLE "grupos_gang_run" ADD CONSTRAINT "grupos_gang_run_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fila_gang_run" ADD CONSTRAINT "fila_gang_run_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fila_gang_run" ADD CONSTRAINT "fila_gang_run_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fila_gang_run" ADD CONSTRAINT "fila_gang_run_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fila_gang_run" ADD CONSTRAINT "fila_gang_run_grupoGangRunId_fkey" FOREIGN KEY ("grupoGangRunId") REFERENCES "grupos_gang_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
