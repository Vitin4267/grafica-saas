-- CreateEnum
CREATE TYPE "TipoImportacaoPlanilha" AS ENUM ('CLIENTES', 'CATALOGO', 'PEDIDOS');

-- CreateEnum
CREATE TYPE "StatusImportacaoPlanilha" AS ENUM ('MAPEANDO', 'CONFIRMADO', 'PROCESSANDO', 'CONCLUIDO', 'ERRO');

-- AlterEnum
ALTER TYPE "TipoArquivoArmazenado" ADD VALUE 'PLANILHA_IMPORTACAO';

-- CreateTable
CREATE TABLE "importacoes_planilha" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tipo" "TipoImportacaoPlanilha" NOT NULL,
    "status" "StatusImportacaoPlanilha" NOT NULL DEFAULT 'MAPEANDO',
    "nomeArquivo" TEXT NOT NULL,
    "arquivoPathname" TEXT,
    "linhasTotal" INTEGER NOT NULL,
    "linhasImportadas" INTEGER NOT NULL DEFAULT 0,
    "linhasComErro" INTEGER NOT NULL DEFAULT 0,
    "mapeamentoSugerido" JSONB,
    "mapeamentoConfirmado" JSONB,
    "erros" JSONB,
    "mensagemErro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "importacoes_planilha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "importacoes_planilha_graficaId_createdAt_idx" ON "importacoes_planilha"("graficaId", "createdAt");

-- CreateIndex
CREATE INDEX "importacoes_planilha_status_createdAt_idx" ON "importacoes_planilha"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "importacoes_planilha" ADD CONSTRAINT "importacoes_planilha_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
