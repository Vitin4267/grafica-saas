-- Arte anexada já no orçamento (Orcamento.arteUrl, visível pro cliente antes
-- da aprovação de arte de verdade na produção) + quantidade por embalagem em
-- matéria-prima (ItemGrafica.quantidadePorEmbalagem, só conversão
-- informativa no catálogo). Duas colunas novas opcionais + um valor de enum
-- novo, nenhuma mudança de comportamento até o código ler/escrever nelas.
-- NOTA: o diff automático também sugeriu DROP TABLE "n8n_chatbot" — mesmo
-- drift pré-existente já identificado nas migrations anteriores desta fase.
-- Removido de propósito, não mexer nela.

-- AlterEnum
ALTER TYPE "TipoArquivoArmazenado" ADD VALUE 'ARTE_ORCAMENTO';

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "quantidadePorEmbalagem" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "arteUrl" TEXT;
