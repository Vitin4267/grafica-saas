-- Achado N4 da auditoria de código (2026-09-04) — motor DIGITAL passa a
-- fazer imposição (nUp) igual ao Offset; o papel (matéria-prima) usado para
-- resolver os FormatoFolha disponíveis é escolhido POR ORÇAMENTO, mesmo
-- padrão de orcamento_item_precificacao_etiquetas.

-- CreateTable
CREATE TABLE "orcamento_item_precificacao_digital" (
    "id" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "papelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orcamento_item_precificacao_digital_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_item_precificacao_digital_orcamentoItemId_key" ON "orcamento_item_precificacao_digital"("orcamentoItemId");

-- AddForeignKey
ALTER TABLE "orcamento_item_precificacao_digital" ADD CONSTRAINT "orcamento_item_precificacao_digital_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_precificacao_digital" ADD CONSTRAINT "orcamento_item_precificacao_digital_papelId_fkey" FOREIGN KEY ("papelId") REFERENCES "itens_grafica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
