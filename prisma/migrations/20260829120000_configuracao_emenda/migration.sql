-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A9 da Parte 1 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): peça maior que a bobina hoje é sempre
-- erro fatal (PECA_EXCEDE_BOBINA) no motor M2 — mas em comunicação visual
-- (backdrop, fachada, outdoor, painel de evento), emendar painéis é rotina.
--
-- ConfiguracaoEmenda é uma config OPCIONAL 1:1 por produto M2 (mesmo padrão
-- de presença-liga/ausência-desliga de configuracoes_cliche_etiqueta): só
-- quando a gráfica cadastra o custo por metro linear de emenda pra um item,
-- o motor passa a calcular nºPainéis + custo de emenda em vez de lançar
-- erro. Sem cadastro, comportamento de hoje é 100% preservado.
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente é alterada.

-- CreateTable
CREATE TABLE "configuracoes_emenda" (
    "id" TEXT NOT NULL,
    "itemGraficaId" TEXT NOT NULL,
    "custoPorMetroLinear" DECIMAL(12,4) NOT NULL,
    "sobreposicaoM" DECIMAL(6,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_emenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_emenda_itemGraficaId_key" ON "configuracoes_emenda"("itemGraficaId");

-- AddForeignKey
ALTER TABLE "configuracoes_emenda" ADD CONSTRAINT "configuracoes_emenda_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE CASCADE ON UPDATE CASCADE;
