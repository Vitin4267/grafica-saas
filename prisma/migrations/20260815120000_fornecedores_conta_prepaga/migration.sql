-- Fornecedores (vínculo em entrada de compra) + conta prepaga (saldo tipo
-- vale-Lalamove). Coluna nova opcional + 3 tabelas novas, nenhuma mudança
-- de comportamento até o código ler/escrever nelas.
-- NOTA: o diff automático também sugeriu DROP TABLE "n8n_chatbot" — mesmo
-- drift pré-existente já identificado nas duas migrations anteriores desta
-- fase. Removido de propósito, não mexer nela.

-- CreateEnum
CREATE TYPE "TipoMovimentacaoContaPrepaga" AS ENUM ('RECARGA', 'DEBITO');

-- AlterTable
ALTER TABLE "movimentacoes_estoque" ADD COLUMN     "fornecedorId" TEXT;

-- CreateTable
CREATE TABLE "fornecedores" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "contato" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_prepagas" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "saldoAtual" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contas_prepagas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes_conta_prepaga" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "tipo" "TipoMovimentacaoContaPrepaga" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_conta_prepaga_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fornecedores_graficaId_idx" ON "fornecedores"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedores_graficaId_nome_key" ON "fornecedores"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "contas_prepagas_graficaId_idx" ON "contas_prepagas"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_prepagas_graficaId_nome_key" ON "contas_prepagas"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "movimentacoes_conta_prepaga_contaId_createdAt_idx" ON "movimentacoes_conta_prepaga"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_fornecedorId_idx" ON "movimentacoes_estoque"("fornecedorId");

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_prepagas" ADD CONSTRAINT "contas_prepagas_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_conta_prepaga" ADD CONSTRAINT "movimentacoes_conta_prepaga_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas_prepagas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
