-- CreateEnum
CREATE TYPE "TipoRegistroManutencao" AS ENUM ('PREVENTIVA', 'QUEBRA');

-- CreateTable
CREATE TABLE "registros_manutencao" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "prensaId" TEXT,
    "maquinaFlexografiaId" TEXT,
    "tipo" "TipoRegistroManutencao" NOT NULL DEFAULT 'QUEBRA',
    "motivo" TEXT NOT NULL,
    "dataInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataFim" TIMESTAMP(3),
    "registradoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registros_manutencao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registros_manutencao_graficaId_idx" ON "registros_manutencao"("graficaId");

-- CreateIndex
CREATE INDEX "registros_manutencao_prensaId_idx" ON "registros_manutencao"("prensaId");

-- CreateIndex
CREATE INDEX "registros_manutencao_maquinaFlexografiaId_idx" ON "registros_manutencao"("maquinaFlexografiaId");

-- AddForeignKey
ALTER TABLE "registros_manutencao" ADD CONSTRAINT "registros_manutencao_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_manutencao" ADD CONSTRAINT "registros_manutencao_prensaId_fkey" FOREIGN KEY ("prensaId") REFERENCES "prensas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_manutencao" ADD CONSTRAINT "registros_manutencao_maquinaFlexografiaId_fkey" FOREIGN KEY ("maquinaFlexografiaId") REFERENCES "maquinas_flexografia"("id") ON DELETE CASCADE ON UPDATE CASCADE;
