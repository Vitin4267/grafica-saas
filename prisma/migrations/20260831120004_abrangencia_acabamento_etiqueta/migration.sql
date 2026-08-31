-- Add SOFT_TOUCH and METALIZADA to TipoLaminacao enum
ALTER TYPE "TipoLaminacao" ADD VALUE 'SOFT_TOUCH';
ALTER TYPE "TipoLaminacao" ADD VALUE 'METALIZADA';

-- Add SOFT_TOUCH to TipoAcabamentoVerniz enum
ALTER TYPE "TipoAcabamentoVerniz" ADD VALUE 'SOFT_TOUCH';

-- Add durabilidadeAdesivo column to orcamento_item_etiquetas
ALTER TABLE "orcamento_item_etiquetas" ADD COLUMN "durabilidadeAdesivo" TEXT;

-- Add tipoEfeitoHotStamping column to orcamento_item_hot_stampings
ALTER TABLE "orcamento_item_hot_stampings" ADD COLUMN "tipoEfeitoHotStamping" TEXT;
