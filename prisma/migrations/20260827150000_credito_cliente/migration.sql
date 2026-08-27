-- Achado A13 da auditoria de abrangência (pesquisa-abrangencia-modulos.md):
-- saldo adiantado que um CLIENTE tem com a gráfica (ex: conta corporativa
-- B2B que deposita adiantado e vai consumindo ao longo dos meses) — sentido
-- oposto de ContaPrepaga (a gráfica com um fornecedor). Só tabelas novas,
-- nenhuma mudança em tabela existente.

-- CreateEnum
CREATE TYPE "TipoMovimentacaoCreditoCliente" AS ENUM ('DEPOSITO', 'CONSUMO', 'ESTORNO', 'AJUSTE');

-- CreateTable
CREATE TABLE "creditos_cliente" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,

    CONSTRAINT "creditos_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes_credito_cliente" (
    "id" TEXT NOT NULL,
    "creditoClienteId" TEXT NOT NULL,
    "tipo" "TipoMovimentacaoCreditoCliente" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "orcamentoId" TEXT,
    "pagamentoId" TEXT,
    "descricao" TEXT,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_credito_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creditos_cliente_clienteId_key" ON "creditos_cliente"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "movimentacoes_credito_cliente_pagamentoId_key" ON "movimentacoes_credito_cliente"("pagamentoId");

-- CreateIndex
CREATE INDEX "movimentacoes_credito_cliente_creditoClienteId_createdAt_idx" ON "movimentacoes_credito_cliente"("creditoClienteId", "createdAt");

-- CreateIndex
CREATE INDEX "movimentacoes_credito_cliente_orcamentoId_idx" ON "movimentacoes_credito_cliente"("orcamentoId");

-- AddForeignKey
ALTER TABLE "creditos_cliente" ADD CONSTRAINT "creditos_cliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_credito_cliente" ADD CONSTRAINT "movimentacoes_credito_cliente_creditoClienteId_fkey" FOREIGN KEY ("creditoClienteId") REFERENCES "creditos_cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_credito_cliente" ADD CONSTRAINT "movimentacoes_credito_cliente_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_credito_cliente" ADD CONSTRAINT "movimentacoes_credito_cliente_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "pagamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
