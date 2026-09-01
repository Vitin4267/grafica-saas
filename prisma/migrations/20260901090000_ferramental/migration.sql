-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado F1 da Parte 7 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "F. Documento e transação"): nenhum
-- model representava a ferramenta física reutilizável (faca de corte e
-- vinco, clichê de flexo/hot stamping, tela de serigrafia, matriz de
-- bordado...) — só o CUSTO dela (ConfiguracaoClicheEtiqueta/Flexografia,
-- ConfiguracaoAcabamento.custoFerramental, OrcamentoItemPrecificacaoEtiqueta.
-- custoFaca). Toda repetição de pedido recalculava o clichê como se fosse
-- novo, mesmo já existindo fisicamente.
--
-- Adiciona:
-- - enum "TipoFerramental": lista fechada + OUTRO (mesmo padrão de
--   CategoriaEquipamento/MaterialSubstrato/etc.).
-- - enum "ProprietarioFerramental": GRAFICA ou CLIENTE.
-- - enum "StatusFerramental": ciclo de vida (ATIVO/EM_MANUTENCAO/
--   DESCARTADO/DEVOLVIDO_AO_CLIENTE).
-- - tabela "ferramentais": cadastro da ferramenta física, com FKs opcionais
--   pra Cliente (dono, quando proprietario=CLIENTE) e ItemGrafica (produto
--   do catálogo que ela produz). Nunca hard delete (mesmo princípio de
--   Cliente/Usuario) — "desativadoEm" marca remoção reversível.
-- - coluna "ferramentalId" em "orcamento_itens": vínculo INFORMATIVO e
--   opcional entre um item de orçamento e uma ferramenta já cadastrada —
--   nunca automático na precificação, só sugere aviso na UI. custoFaca/
--   custoClichePorCm2 e o preço final continuam 100% manuais.
--
-- Migração 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado é reescrito. Todo orçamento já
-- existente fica com ferramentalId=NULL (comportamento de hoje 100%
-- preservado) e nenhuma gráfica tem nenhum Ferramental cadastrado até que
-- alguém crie um pela nova tela em /configuracoes/ferramentais.

-- CreateEnum
CREATE TYPE "TipoFerramental" AS ENUM ('FACA_CORTE_VINCO', 'CLICHE_FLEXO', 'CLICHE_HOT_STAMPING', 'TELA_SERIGRAFIA', 'MATRIZ_BORDADO', 'CILINDRO_ROTOGRAVURA', 'FERRAMENTA_ACABAMENTO', 'OUTRO');

-- CreateEnum
CREATE TYPE "ProprietarioFerramental" AS ENUM ('GRAFICA', 'CLIENTE');

-- CreateEnum
CREATE TYPE "StatusFerramental" AS ENUM ('ATIVO', 'EM_MANUTENCAO', 'DESCARTADO', 'DEVOLVIDO_AO_CLIENTE');

-- CreateTable
CREATE TABLE "ferramentais" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "tipo" "TipoFerramental" NOT NULL,
    "tipoOutro" TEXT,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT,
    "clienteId" TEXT,
    "proprietario" "ProprietarioFerramental" NOT NULL DEFAULT 'GRAFICA',
    "itemGraficaId" TEXT,
    "localizacao" TEXT,
    "tiragensAcumuladas" INTEGER NOT NULL DEFAULT 0,
    "status" "StatusFerramental" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "desativadoEm" TIMESTAMP(3),

    CONSTRAINT "ferramentais_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN "ferramentalId" TEXT;

-- CreateIndex
CREATE INDEX "ferramentais_graficaId_idx" ON "ferramentais"("graficaId");

-- CreateIndex
CREATE INDEX "ferramentais_graficaId_status_idx" ON "ferramentais"("graficaId", "status");

-- CreateIndex
CREATE INDEX "ferramentais_clienteId_idx" ON "ferramentais"("clienteId");

-- CreateIndex
CREATE INDEX "ferramentais_itemGraficaId_idx" ON "ferramentais"("itemGraficaId");

-- CreateIndex
CREATE UNIQUE INDEX "ferramentais_graficaId_codigo_key" ON "ferramentais"("graficaId", "codigo");

-- CreateIndex
CREATE INDEX "orcamento_itens_ferramentalId_idx" ON "orcamento_itens"("ferramentalId");

-- AddForeignKey
ALTER TABLE "ferramentais" ADD CONSTRAINT "ferramentais_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ferramentais" ADD CONSTRAINT "ferramentais_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ferramentais" ADD CONSTRAINT "ferramentais_itemGraficaId_fkey" FOREIGN KEY ("itemGraficaId") REFERENCES "itens_grafica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_ferramentalId_fkey" FOREIGN KEY ("ferramentalId") REFERENCES "ferramentais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
