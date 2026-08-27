-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "prazoEmDiasUteis" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "parametros_grafica" ADD COLUMN     "diasFuncionamento" INTEGER NOT NULL DEFAULT 31;

-- CreateTable
CREATE TABLE "feriados_grafica" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "descricao" TEXT NOT NULL,
    "recorrenteAnual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "feriados_grafica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feriados_grafica_graficaId_data_key" ON "feriados_grafica"("graficaId", "data");

-- CreateIndex
CREATE INDEX "feriados_grafica_graficaId_idx" ON "feriados_grafica"("graficaId");

-- AddForeignKey
ALTER TABLE "feriados_grafica" ADD CONSTRAINT "feriados_grafica_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
