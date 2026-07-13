-- CreateEnum
CREATE TYPE "BaseComissao" AS ENUM ('VALOR', 'LUCRO');

-- CreateEnum
CREATE TYPE "StatusComissao" AS ENUM ('PENDENTE', 'PAGA');

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "filialId" TEXT;

-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "comissaoVendedorBase" "BaseComissao" NOT NULL DEFAULT 'VALOR';

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "comissaoPercent" DECIMAL(5,4);

-- CreateTable
CREATE TABLE "filiais" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "endereco" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "filiais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comissoes" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "baseCalculo" "BaseComissao" NOT NULL,
    "percentualAplicado" DECIMAL(5,4) NOT NULL,
    "valorBase" DECIMAL(12,2) NOT NULL,
    "valorComissao" DECIMAL(12,2) NOT NULL,
    "status" "StatusComissao" NOT NULL DEFAULT 'PENDENTE',
    "pagoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "despesaId" TEXT,

    CONSTRAINT "comissoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "filiais_graficaId_idx" ON "filiais"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "filiais_graficaId_nome_key" ON "filiais"("graficaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "comissoes_orcamentoId_key" ON "comissoes"("orcamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "comissoes_despesaId_key" ON "comissoes"("despesaId");

-- CreateIndex
CREATE INDEX "comissoes_graficaId_status_idx" ON "comissoes"("graficaId", "status");

-- CreateIndex
CREATE INDEX "comissoes_usuarioId_idx" ON "comissoes"("usuarioId");

-- CreateIndex
CREATE INDEX "orcamentos_filialId_idx" ON "orcamentos"("filialId");

-- AddForeignKey
ALTER TABLE "filiais" ADD CONSTRAINT "filiais_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "filiais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_despesaId_fkey" FOREIGN KEY ("despesaId") REFERENCES "despesas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
