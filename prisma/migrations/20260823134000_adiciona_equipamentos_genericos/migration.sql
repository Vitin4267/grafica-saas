-- CreateEnum
CREATE TYPE "CategoriaEquipamento" AS ENUM ('GUILHOTINA', 'LAMINADORA', 'DOBRADEIRA', 'ENCADERNADORA', 'GRAMPEADEIRA', 'PLOTTER_RECORTE', 'IMPRESSORA_GRANDE_FORMATO', 'OUTRO');

-- AlterTable
ALTER TABLE "registros_manutencao" ADD COLUMN     "equipamentoId" TEXT;

-- CreateTable
CREATE TABLE "equipamentos" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" "CategoriaEquipamento" NOT NULL,
    "categoriaOutro" TEXT,
    "marca" TEXT,
    "modelo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipamentos_graficaId_idx" ON "equipamentos"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "equipamentos_graficaId_nome_key" ON "equipamentos"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "registros_manutencao_equipamentoId_idx" ON "registros_manutencao"("equipamentoId");

-- AddForeignKey
ALTER TABLE "equipamentos" ADD CONSTRAINT "equipamentos_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_manutencao" ADD CONSTRAINT "registros_manutencao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
