-- CreateTable
CREATE TABLE "dados_fiscais_filial" (
    "id" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
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

    CONSTRAINT "dados_fiscais_filial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dados_fiscais_filial_filialId_key" ON "dados_fiscais_filial"("filialId");

-- AddForeignKey
ALTER TABLE "dados_fiscais_filial" ADD CONSTRAINT "dados_fiscais_filial_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "filiais"("id") ON DELETE CASCADE ON UPDATE CASCADE;
