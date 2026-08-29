-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A4 da Parte 3 (Compras) da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): o status COTANDO não guardava nenhuma
-- cotação de verdade — só um único fornecedorId+valorEstimado por
-- solicitação, sem forma de registrar e comparar cotações concorrentes
-- (preço, prazo, condição de pagamento) antes de aprovar.
--
-- Adiciona:
-- - tabela cotacoes_fornecedor: uma linha por (SolicitacaoCompra,
--   Fornecedor) cotado, com preço, prazo, condição de pagamento, frete e
--   flag de vencedora.
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito.

-- CreateTable
CREATE TABLE "cotacoes_fornecedor" (
    "id" TEXT NOT NULL,
    "solicitacaoCompraId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "precoUnitario" DECIMAL(12,4) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "prazoEntregaDias" INTEGER,
    "condicaoPagamento" TEXT,
    "validaAte" TIMESTAMP(3),
    "frete" DECIMAL(12,2),
    "observacao" TEXT,
    "vencedora" BOOLEAN NOT NULL DEFAULT false,
    "registradaPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cotacoes_fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cotacoes_fornecedor_solicitacaoCompraId_fornecedorId_key" ON "cotacoes_fornecedor"("solicitacaoCompraId", "fornecedorId");

-- CreateIndex
CREATE INDEX "cotacoes_fornecedor_solicitacaoCompraId_idx" ON "cotacoes_fornecedor"("solicitacaoCompraId");

-- CreateIndex
CREATE INDEX "cotacoes_fornecedor_fornecedorId_idx" ON "cotacoes_fornecedor"("fornecedorId");

-- AddForeignKey
ALTER TABLE "cotacoes_fornecedor" ADD CONSTRAINT "cotacoes_fornecedor_solicitacaoCompraId_fkey" FOREIGN KEY ("solicitacaoCompraId") REFERENCES "solicitacoes_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotacoes_fornecedor" ADD CONSTRAINT "cotacoes_fornecedor_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotacoes_fornecedor" ADD CONSTRAINT "cotacoes_fornecedor_registradaPorId_fkey" FOREIGN KEY ("registradaPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
