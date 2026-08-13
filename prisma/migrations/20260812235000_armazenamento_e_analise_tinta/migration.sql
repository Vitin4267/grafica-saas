-- CreateEnum
CREATE TYPE "TipoArquivoArmazenado" AS ENUM ('ARTE_PEDIDO', 'LOGO_GRAFICA', 'ANALISE_TINTA');

-- CreateTable
CREATE TABLE "arquivos_armazenados" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "tipo" "TipoArquivoArmazenado" NOT NULL,
    "referenciaId" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "url" TEXT,
    "pathname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arquivos_armazenados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_item_tinta" (
    "id" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "imagemUrl" TEXT NOT NULL,
    "imagemPathname" TEXT NOT NULL,
    "imagemTipo" TEXT NOT NULL,
    "coberturaPercentual" DECIMAL(5,2) NOT NULL,
    "coberturaCiano" DECIMAL(5,2),
    "coberturaMagenta" DECIMAL(5,2),
    "coberturaAmarelo" DECIMAL(5,2),
    "coberturaPreto" DECIMAL(5,2),
    "consumoMlPorPeca" DECIMAL(12,6) NOT NULL,
    "consumoMlTotal" DECIMAL(12,3) NOT NULL,
    "confianca" TEXT NOT NULL,
    "observacao" TEXT,
    "modeloIa" TEXT,
    "quantidadeSnapshot" INTEGER NOT NULL,
    "larguraCmSnapshot" DECIMAL(8,2),
    "alturaCmSnapshot" DECIMAL(8,2),
    "criadoPorUsuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orcamento_item_tinta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analise_tinta_log" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analise_tinta_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arquivos_armazenados_url_key" ON "arquivos_armazenados"("url");

-- CreateIndex
CREATE INDEX "arquivos_armazenados_graficaId_idx" ON "arquivos_armazenados"("graficaId");

-- CreateIndex
CREATE INDEX "arquivos_armazenados_tipo_referenciaId_idx" ON "arquivos_armazenados"("tipo", "referenciaId");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_item_tinta_orcamentoItemId_key" ON "orcamento_item_tinta"("orcamentoItemId");

-- CreateIndex
CREATE INDEX "analise_tinta_log_usuarioId_createdAt_idx" ON "analise_tinta_log"("usuarioId", "createdAt");

-- CreateIndex
CREATE INDEX "analise_tinta_log_graficaId_createdAt_idx" ON "analise_tinta_log"("graficaId", "createdAt");

-- AddForeignKey
ALTER TABLE "arquivos_armazenados" ADD CONSTRAINT "arquivos_armazenados_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_tinta" ADD CONSTRAINT "orcamento_item_tinta_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
