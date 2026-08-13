-- CreateEnum
CREATE TYPE "TipoPedidoOrcamento" AS ENUM ('MODELO_NOVO', 'REPETICAO_SEM_ALTERACAO', 'REPETICAO_COM_ALTERACAO');

-- CreateEnum
CREATE TYPE "TipoFrete" AS ENUM ('EMITENTE', 'DESTINATARIO');

-- CreateEnum
CREATE TYPE "MaterialSubstrato" AS ENUM ('PAPEL_TERMICO', 'COUCHE_C_ROT', 'BOPP_METALIZADO_ROT', 'BOPP_BCO_PEROLIZADO', 'BOPP_BCO_FOSCO', 'BOPP_TRANSPARENTE', 'L2_SEM_ADESIVO', 'POLIETILENO_BRANCO', 'POLIETILENO_TRANSPARENTE', 'POLIESTER_BRANCO', 'POLIESTER_TRANSPARENTE', 'POLIESTER_CROMO_FOSCO', 'ELETROSTATICO_SEM_COLA', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoAdesivo" AS ENUM ('ACRILICO_20G', 'ACRILICO_30G', 'BORRACHA_20G', 'BORRACHA_25G', 'BORRACHA_30G', 'BORRACHA_50G');

-- CreateEnum
CREATE TYPE "SuperficieAplicacao" AS ENUM ('VIDRO', 'PLASTICO', 'METAL', 'PAPEL', 'PAPELAO', 'OUTROS');

-- CreateEnum
CREATE TYPE "TipoRotulagem" AS ENUM ('MANUAL', 'AUTOMATICA');

-- CreateEnum
CREATE TYPE "TipoSerrilha" AS ENUM ('SERRILHA', 'MICRO_SERRILHA', 'GAP');

-- CreateEnum
CREATE TYPE "TipoLaminacao" AS ENUM ('BRILHO', 'FOSCO');

-- CreateEnum
CREATE TYPE "TipoAcabamentoVerniz" AS ENUM ('BRILHO', 'FOSCO', 'RIBBON');

-- CreateEnum
CREATE TYPE "TipoHotStamping" AS ENUM ('HOT', 'COLD');

-- CreateEnum
CREATE TYPE "LadoEtiqueta" AS ENUM ('ROTULO', 'CONTRA_ROTULO');

-- AlterTable
ALTER TABLE "orcamentos" ADD COLUMN     "vendedor" TEXT,
ADD COLUMN     "tipoPedido" "TipoPedidoOrcamento",
ADD COLUMN     "contatoNome" TEXT,
ADD COLUMN     "contatoEmail" TEXT,
ADD COLUMN     "condicoesPagamento" TEXT,
ADD COLUMN     "frete" "TipoFrete",
ADD COLUMN     "transportadora" TEXT,
ADD COLUMN     "localEntrega" TEXT,
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "etapaOrcamentoDesenvolvimentoEm" TIMESTAMP(3),
ADD COLUMN     "etapaOrcamentoDesenvolvimentoResponsavel" TEXT,
ADD COLUMN     "etapaLayoutEm" TIMESTAMP(3),
ADD COLUMN     "etapaLayoutResponsavel" TEXT,
ADD COLUMN     "etapaAprovacaoEm" TIMESTAMP(3),
ADD COLUMN     "etapaAprovacaoResponsavel" TEXT,
ADD COLUMN     "etapaConfirmacaoPedidoEm" TIMESTAMP(3),
ADD COLUMN     "etapaConfirmacaoPedidoResponsavel" TEXT,
ADD COLUMN     "etapaEntregaEm" TIMESTAMP(3),
ADD COLUMN     "etapaEntregaResponsavel" TEXT;

-- CreateTable
CREATE TABLE "orcamento_item_etiquetas" (
    "id" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "materialSubstrato" "MaterialSubstrato",
    "materialSubstratoOutro" TEXT,
    "tipoAdesivo" "TipoAdesivo",
    "superficieAplicacao" "SuperficieAplicacao",
    "formatoEtiqueta" TEXT,
    "coresRotulo" INTEGER,
    "coresContraRotulo" INTEGER,
    "embalagemQtdPorRolo" INTEGER,
    "tubeteMedida" TEXT,
    "rotulagem" "TipoRotulagem",
    "serrilha" "TipoSerrilha",
    "vernizRotuloTotal" BOOLEAN NOT NULL DEFAULT false,
    "vernizRotuloReserva" BOOLEAN NOT NULL DEFAULT false,
    "vernizRotuloTipo" "TipoAcabamentoVerniz",
    "vernizContraRotuloTotal" BOOLEAN NOT NULL DEFAULT false,
    "vernizContraRotuloReserva" BOOLEAN NOT NULL DEFAULT false,
    "vernizContraRotuloTipo" "TipoAcabamentoVerniz",
    "laminacaoRotulo" "TipoLaminacao",
    "laminacaoContraRotulo" "TipoLaminacao",
    "rebobinamento" INTEGER,

    CONSTRAINT "orcamento_item_etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_item_hot_stampings" (
    "id" TEXT NOT NULL,
    "orcamentoItemEtiquetaId" TEXT NOT NULL,
    "lado" "LadoEtiqueta" NOT NULL,
    "tipo" "TipoHotStamping" NOT NULL,
    "medida" TEXT,
    "cor" TEXT,

    CONSTRAINT "orcamento_item_hot_stampings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_item_etiquetas_orcamentoItemId_key" ON "orcamento_item_etiquetas"("orcamentoItemId");

-- CreateIndex
CREATE INDEX "orcamento_item_hot_stampings_orcamentoItemEtiquetaId_idx" ON "orcamento_item_hot_stampings"("orcamentoItemEtiquetaId");

-- AddForeignKey
ALTER TABLE "orcamento_item_etiquetas" ADD CONSTRAINT "orcamento_item_etiquetas_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_hot_stampings" ADD CONSTRAINT "orcamento_item_hot_stampings_orcamentoItemEtiquetaId_fkey" FOREIGN KEY ("orcamentoItemEtiquetaId") REFERENCES "orcamento_item_etiquetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
