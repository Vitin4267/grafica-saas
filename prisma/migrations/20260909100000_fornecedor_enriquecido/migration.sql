-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A5 da Parte 3 (Compras) da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): Fornecedor era um cadastro-esqueleto
-- (nome, contato texto livre, ativo) — sem CNPJ estruturado com unicidade,
-- categoria, prazo/forma de pagamento, lead time, lote mínimo. Esta
-- migração enriquece o cadastro + adiciona vínculo opcional em
-- Despesa.fornecedorId.
--
-- 100% aditivo: 2 enums novos + 8 colunas nullable em "fornecedores"
-- (email, telefone, categoria, categoriaOutro, condicaoPagamentoPadrao,
-- condicaoPagamentoPadraoOutro, prazoEntregaMedioDias, pedidoMinimoValor) +
-- 1 índice único novo (graficaId, documento — seguro mesmo com a coluna
-- majoritariamente NULL hoje, Postgres não considera NULLs iguais em
-- UNIQUE) + 1 coluna nullable em "despesas" (fornecedorId) + FK SetNull.
-- Nenhuma coluna/tabela existente muda de nome/tipo/obrigatoriedade —
-- fornecedor e despesa já cadastrados continuam funcionando exatamente
-- como hoje.
--
-- ESCOPO DELIBERADAMENTE REDUZIDO: só cadastro enriquecido + vínculo
-- informativo. A geração AUTOMÁTICA de parcelas de contas a pagar ao
-- avançar SolicitacaoCompra pra COMPRADO (parte original do achado A5,
-- marcada 🔴 Caro) NÃO foi construída nesta rodada — nenhuma automação
-- financeira lê os campos novos ainda.

-- CreateEnum
CREATE TYPE "CategoriaFornecedor" AS ENUM ('PAPEL_CARTAO', 'TINTA_VERNIZ', 'CHAPA_CLICHE_MATRIZ', 'SUBSTRATO_RIGIDO', 'TECIDO_LINHA_BORDADO', 'BRINDE_PROMOCIONAL', 'ACABAMENTO_TERCEIRIZADO', 'OUTRO');

-- CreateEnum
CREATE TYPE "CondicaoPagamentoFornecedor" AS ENUM ('A_VISTA', 'BOLETO_30_60_90', 'PIX', 'OUTRO');

-- AlterTable
ALTER TABLE "fornecedores" ADD COLUMN     "email" TEXT,
ADD COLUMN     "telefone" TEXT,
ADD COLUMN     "categoria" "CategoriaFornecedor",
ADD COLUMN     "categoriaOutro" TEXT,
ADD COLUMN     "condicaoPagamentoPadrao" "CondicaoPagamentoFornecedor",
ADD COLUMN     "condicaoPagamentoPadraoOutro" TEXT,
ADD COLUMN     "prazoEntregaMedioDias" INTEGER,
ADD COLUMN     "pedidoMinimoValor" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "despesas" ADD COLUMN     "fornecedorId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "fornecedores_graficaId_documento_key" ON "fornecedores"("graficaId", "documento");

-- CreateIndex
CREATE INDEX "despesas_fornecedorId_idx" ON "despesas"("fornecedorId");

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
