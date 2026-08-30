-- Achado A6 da auditoria de abrangência (Parte 3/Compras, 2026-08-29):
-- unidade de COMPRA (comercial, ex: FARDO/RESMA/BOBINA/TONELADA) separada da
-- unidade de ESTOQUE — mesmo raciocínio do par uCom/uTrib da NF-e brasileira.
-- Tudo aditivo e nullable: solicitação/item que não usa a feature nova
-- continua funcionando exatamente como hoje.

-- CreateEnum
CREATE TYPE "UnidadeCompra" AS ENUM ('FARDO', 'RESMA', 'BOBINA', 'ROLO', 'PALETE', 'CAIXA', 'UNIDADE', 'KG', 'TONELADA', 'OUTRO');

-- AlterTable: ItemGrafica — configuração padrão de compra (pré-preenchimento
-- + aviso de lote/múltiplo, nunca bloqueio).
ALTER TABLE "itens_grafica" ADD COLUMN "unidadeCompraPadrao" "UnidadeCompra",
ADD COLUMN "unidadeCompraPadraoOutro" TEXT,
ADD COLUMN "fatorConversaoCompraPadrao" DECIMAL(12,4),
ADD COLUMN "loteMinimoCompra" DECIMAL(12,4),
ADD COLUMN "multiploCompra" DECIMAL(12,4);

-- AlterTable: SolicitacaoCompra — unidade/quantidade de compra desta compra
-- específica. `quantidade` (unidade de estoque) continua a única coluna lida
-- pelo resto do sistema.
ALTER TABLE "solicitacoes_compra" ADD COLUMN "unidadeCompra" "UnidadeCompra",
ADD COLUMN "unidadeCompraOutro" TEXT,
ADD COLUMN "quantidadeCompra" DECIMAL(12,4),
ADD COLUMN "fatorConversaoCompra" DECIMAL(12,4),
ADD COLUMN "precoUnitarioCompra" DECIMAL(12,4);
