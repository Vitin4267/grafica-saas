-- CreateEnum
CREATE TYPE "StatusNotaFiscal" AS ENUM ('PROCESSANDO', 'AUTORIZADA', 'REJEITADA', 'CANCELADA', 'ERRO');

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "enderecoBairro" TEXT,
ADD COLUMN     "enderecoCep" TEXT,
ADD COLUMN     "enderecoCodigoIbge" TEXT,
ADD COLUMN     "enderecoComplemento" TEXT,
ADD COLUMN     "enderecoLogradouro" TEXT,
ADD COLUMN     "enderecoMunicipio" TEXT,
ADD COLUMN     "enderecoNumero" TEXT,
ADD COLUMN     "enderecoUf" TEXT;

-- AlterTable
ALTER TABLE "itens_catalogo" ADD COLUMN     "ncm" TEXT;

-- CreateTable
CREATE TABLE "dados_fiscais_grafica" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "focusNfeToken" TEXT,
    "ambiente" TEXT NOT NULL DEFAULT 'homologacao',
    "cnpj" TEXT,
    "razaoSocial" TEXT,
    "nomeFantasia" TEXT,
    "inscricaoEstadual" TEXT,
    "regimeTributario" TEXT,
    "enderecoCep" TEXT,
    "enderecoLogradouro" TEXT,
    "enderecoNumero" TEXT,
    "enderecoBairro" TEXT,
    "enderecoMunicipio" TEXT,
    "enderecoUf" TEXT,
    "naturezaOperacaoPadrao" TEXT NOT NULL DEFAULT 'Venda de mercadoria',
    "cfopPadrao" TEXT NOT NULL DEFAULT '5102',
    "csosnPadrao" TEXT NOT NULL DEFAULT '102',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dados_fiscais_grafica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_fiscais" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "status" "StatusNotaFiscal" NOT NULL DEFAULT 'PROCESSANDO',
    "numero" TEXT,
    "serie" TEXT,
    "chaveAcesso" TEXT,
    "xmlUrl" TEXT,
    "danfeUrl" TEXT,
    "mensagemErro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_fiscais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dados_fiscais_grafica_graficaId_key" ON "dados_fiscais_grafica"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "notas_fiscais_orcamentoId_key" ON "notas_fiscais"("orcamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "notas_fiscais_referencia_key" ON "notas_fiscais"("referencia");

-- CreateIndex
CREATE INDEX "notas_fiscais_graficaId_idx" ON "notas_fiscais"("graficaId");

-- AddForeignKey
ALTER TABLE "dados_fiscais_grafica" ADD CONSTRAINT "dados_fiscais_grafica_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
