-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Feature de nota fiscal PARCIAL (2026-09-22) — dono relatou caso real do
-- pai (Assus Graphics): cliente urgente pediu pra despachar só uma PARTE do
-- pedido, e o sistema não deixava emitir NF-e de parte de um orçamento
-- (notas_fiscais_orcamentoId_modelo_key travava em 1 NF-e por orçamento,
-- sem exceção). Ver plano completo em
-- ~/.claude/plans/deep-zooming-parasol.md.
--
-- Troca o índice ÚNICO (orcamentoId, modelo) por um índice normal — mesma
-- forma da migration de entrega_multipla_por_pedido (2026-09-14): nenhuma
-- linha existente muda, nenhum dado perdido, só deixa de impedir uma
-- segunda NFE pro mesmo orçamento. A regra "não pode faturar mais do que
-- resta" passa a viver na Server Action (emitirNotaFiscal,
-- src/app/orcamento/[id]/actions/nfe.ts), não mais no banco.
--
-- nota_fiscal_itens é nova: snapshot de quanto de cada OrcamentoItem foi
-- incluído em cada NotaFiscal (quantidade/precoUnitario/precoTotal em 4
-- casas, mesma precisão de orcamento_itens desde a migration de
-- 2026-09-21). Sem graficaId próprio — escopada via notaFiscalId, mesmo
-- padrão de baixas_conta_receber/pagamentos_despesa (migration de
-- 2026-08-29).

-- DropIndex
DROP INDEX "notas_fiscais_orcamentoId_modelo_key";

-- CreateIndex
CREATE INDEX "notas_fiscais_orcamentoId_modelo_idx" ON "notas_fiscais"("orcamentoId", "modelo");

-- CreateTable
CREATE TABLE "nota_fiscal_itens" (
    "id" TEXT NOT NULL,
    "notaFiscalId" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "precoUnitario" DECIMAL(12,4) NOT NULL,
    "precoTotal" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nota_fiscal_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nota_fiscal_itens_notaFiscalId_idx" ON "nota_fiscal_itens"("notaFiscalId");

-- CreateIndex
CREATE INDEX "nota_fiscal_itens_orcamentoItemId_idx" ON "nota_fiscal_itens"("orcamentoItemId");

-- AddForeignKey
ALTER TABLE "nota_fiscal_itens" ADD CONSTRAINT "nota_fiscal_itens_notaFiscalId_fkey" FOREIGN KEY ("notaFiscalId") REFERENCES "notas_fiscais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_fiscal_itens" ADD CONSTRAINT "nota_fiscal_itens_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
