-- CreateEnum
CREATE TYPE "StatusSolicitacaoCompra" AS ENUM ('SOLICITADO', 'COTANDO', 'APROVADO', 'COMPRADO', 'RECEBIDO', 'CONFERIDO', 'CANCELADO');

-- AlterEnum
ALTER TYPE "ModuloPermissao" ADD VALUE 'COMPRAS';

-- AlterTable
ALTER TABLE "movimentacoes_estoque" ADD COLUMN     "solicitacaoCompraId" TEXT;

-- CreateTable
CREATE TABLE "solicitacoes_compra" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "status" "StatusSolicitacaoCompra" NOT NULL DEFAULT 'SOLICITADO',
    "itemGraficaId" TEXT NOT NULL,
    "varianteId" TEXT,
    "fornecedorId" TEXT,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "valorEstimado" DECIMAL(12,2),
    "valorFinal" DECIMAL(12,2),
    "observacao" TEXT,
    "usuarioSolicitanteId" TEXT NOT NULL,
    "usuarioAprovadorId" TEXT,
    "solicitadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cotandoEm" TIMESTAMP(3),
    "aprovadoEm" TIMESTAMP(3),
    "compradoEm" TIMESTAMP(3),
    "recebidoEm" TIMESTAMP(3),
    "conferidoEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "documento" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitacoes_compra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitacoes_compra_graficaId_status_idx" ON "solicitacoes_compra"("graficaId", "status");

-- CreateIndex
CREATE INDEX "solicitacoes_compra_itemGraficaId_idx" ON "solicitacoes_compra"("itemGraficaId");

-- CreateIndex
CREATE INDEX "solicitacoes_compra_varianteId_idx" ON "solicitacoes_compra"("varianteId");

-- CreateIndex
CREATE INDEX "solicitacoes_compra_fornecedorId_idx" ON "solicitacoes_compra"("fornecedorId");

-- CreateIndex
CREATE INDEX "solicitacoes_compra_usuarioSolicitanteId_idx" ON "solicitacoes_compra"("usuarioSolicitanteId");

-- CreateIndex
CREATE UNIQUE INDEX "movimentacoes_estoque_solicitacaoCompraId_key" ON "movimentacoes_estoque"("solicitacaoCompraId");

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_solicitacaoCompraId_fkey" FOREIGN KEY ("solicitacaoCompraId") REFERENCES "solicitacoes_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_compra" ADD CONSTRAINT "solicitacoes_compra_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_compra" ADD CONSTRAINT "solicitacoes_compra_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_compra" ADD CONSTRAINT "solicitacoes_compra_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "variantes_materia_prima"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_compra" ADD CONSTRAINT "solicitacoes_compra_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_compra" ADD CONSTRAINT "solicitacoes_compra_usuarioSolicitanteId_fkey" FOREIGN KEY ("usuarioSolicitanteId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_compra" ADD CONSTRAINT "solicitacoes_compra_usuarioAprovadorId_fkey" FOREIGN KEY ("usuarioAprovadorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

