-- Lote de configurabilidade por gráfica (achado por auditoria em 3 áreas do
-- site: orçamento/catálogo, produção/financeiro, configurações/fiscal) —
-- tudo aditivo, nenhuma coluna/tabela removida ou renomeada.
-- NOTA: o diff automático também sugeriu DROP TABLE "n8n_chatbot" — mesmo
-- drift pré-existente já identificado nas migrations anteriores desta fase.
-- Removido de propósito, não mexer nela.

-- AlterEnum
ALTER TYPE "TipoAcabamentoVerniz" ADD VALUE 'OUTRO';

-- AlterEnum
ALTER TYPE "TipoAdesivo" ADD VALUE 'OUTRO';

-- AlterEnum
ALTER TYPE "TipoHotStamping" ADD VALUE 'OUTRO';

-- AlterEnum
ALTER TYPE "TipoLaminacao" ADD VALUE 'OUTRO';

-- AlterEnum
ALTER TYPE "TipoSerrilha" ADD VALUE 'OUTRO';

-- AlterEnum
ALTER TYPE "UnidadeMedida" ADD VALUE 'OUTRO';

-- AlterTable
ALTER TABLE "automacao_grafica" ADD COLUMN     "notificarEstoqueCritico" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notificarPedidoAtrasado" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notificarStatusMudou" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "despesas" ADD COLUMN     "categoriaCustoId" TEXT,
ADD COLUMN     "formaPagamentoDetalhe" TEXT;

-- AlterTable
ALTER TABLE "graficas" ADD COLUMN     "corPrimaria" TEXT;

-- AlterTable
ALTER TABLE "itens_catalogo" ADD COLUMN     "unidadeOutro" TEXT;

-- AlterTable
ALTER TABLE "orcamento_item_etiquetas" ADD COLUMN     "laminacaoContraRotuloOutro" TEXT,
ADD COLUMN     "laminacaoRotuloOutro" TEXT,
ADD COLUMN     "serrilhaOutro" TEXT,
ADD COLUMN     "superficieAplicacaoOutro" TEXT,
ADD COLUMN     "tipoAdesivoOutro" TEXT,
ADD COLUMN     "vernizContraRotuloTipoOutro" TEXT,
ADD COLUMN     "vernizRotuloTipoOutro" TEXT;

-- AlterTable
ALTER TABLE "orcamento_item_hot_stampings" ADD COLUMN     "tipoOutro" TEXT;

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "formaDetalhe" TEXT;

-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "alertaPrazoAtivo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alertaPrazoLimiar1Dias" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "alertaPrazoLimiar2Dias" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "alertaPrazoLimiar3Dias" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_categoriaCustoId_fkey" FOREIGN KEY ("categoriaCustoId") REFERENCES "categorias_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
