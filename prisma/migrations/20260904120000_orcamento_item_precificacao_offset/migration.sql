-- Achado N8 da auditoria de código (2026-09-04) — no Offset, papel
-- (matéria-prima) e gramatura são propriedade FIXA do produto cadastrado em
-- Catálogo; este model deixa a gráfica sobrepor os dois POR ORÇAMENTO, mesmo
-- padrão de orcamento_item_precificacao_digital, mas com papelId E
-- gramaturaGm2 NULLABLE (diferente daquela, obrigatória lá) — os dois podem
-- ser sobrescritos independentemente um do outro, e a linha só existe quando
-- ao menos um dos dois foi de fato sobrescrito neste orçamento.

-- CreateTable
CREATE TABLE "orcamento_item_precificacao_offset" (
    "id" TEXT NOT NULL,
    "orcamentoItemId" TEXT NOT NULL,
    "papelId" TEXT,
    "gramaturaGm2" DECIMAL(6,1),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orcamento_item_precificacao_offset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_item_precificacao_offset_orcamentoItemId_key" ON "orcamento_item_precificacao_offset"("orcamentoItemId");

-- AddForeignKey
ALTER TABLE "orcamento_item_precificacao_offset" ADD CONSTRAINT "orcamento_item_precificacao_offset_orcamentoItemId_fkey" FOREIGN KEY ("orcamentoItemId") REFERENCES "orcamento_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item_precificacao_offset" ADD CONSTRAINT "orcamento_item_precificacao_offset_papelId_fkey" FOREIGN KEY ("papelId") REFERENCES "itens_grafica"("id") ON DELETE SET NULL ON UPDATE CASCADE;
