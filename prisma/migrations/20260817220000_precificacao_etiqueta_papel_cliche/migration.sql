-- CreateTable
CREATE TABLE "configuracoes_cliche_etiqueta" (
    "id" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "custoClicheUnitario" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_cliche_etiqueta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_item_precificacao_etiquetas" (
    "id" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "papelId" TEXT NOT NULL,
    "quantidadeCores" INTEGER NOT NULL,
    "custoClicheCalculado" DECIMAL(12,4) NOT NULL,
    "custoFaca" DECIMAL(12,4),
    "custoFrete" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orcamento_item_precificacao_etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_cliche_etiqueta_itemGraficaId_key" ON "configuracoes_cliche_etiqueta"("itemGraficaId");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_item_precificacao_etiquetas_orcamentoItemId_key" ON "orcamento_item_precificacao_etiquetas"("orcamentoItemId");

-- AddForeignKey
ALTER TABLE "configuracoes_cliche_etiqueta" ADD CONSTRAINT "configuracoes_cliche_etiqueta_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_precificacao_etiquetas" ADD CONSTRAINT "orcamento_item_precificacao_etiquetas_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_precificacao_etiquetas" ADD CONSTRAINT "orcamento_item_precificacao_etiquetas_papelId_fkey" FOREIGN KEY ("papelId") REFERENCES "itens_grafica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
