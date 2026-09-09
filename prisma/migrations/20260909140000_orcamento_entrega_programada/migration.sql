-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado B3/Parte 1 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md) — versão CONTRATUAL/DECLARATIVA,
-- ESCOPO DELIBERADAMENTE REDUZIDO (2026-09-09). Cria uma tabela PARALELA
-- (não mexe em nenhuma tabela/coluna existente) pra registrar o cronograma
-- de entrega COMBINADO com o cliente num orçamento ("produz 60.000
-- rótulos agora, entrega 10.000/mês por 6 meses" — perfil real de
-- gráfica de embalagem/rótulo, cliente-piloto Assus Graphics). Ver
-- comentário completo no model OrcamentoEntregaProgramada
-- (09-orcamento.prisma) pro raciocínio de escopo (por que a versão
-- completa com N `Entrega` físicas/`ContaReceber` por entrega ficou de
-- fora) e pro critério de validação de soma (feita em APP, não em banco).
--
-- Migração 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado é reescrito. Toda gráfica/
-- orçamento existente fica sem nenhuma linha nesta tabela nova até que
-- alguém adicione uma linha de cronograma pela tela em /orcamento/[id]
-- (ver src/app/orcamento/[id]/actions/entrega-programada.ts).

-- CreateTable
CREATE TABLE "orcamento_entregas_programadas" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "quantidade" INTEGER NOT NULL,
    "dataPrevista" DATE,
    "localEntrega" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orcamento_entregas_programadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orcamento_entregas_programadas_graficaId_idx" ON "orcamento_entregas_programadas"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_entregas_programadas_orcamentoId_ordem_key" ON "orcamento_entregas_programadas"("orcamentoId", "ordem");

-- AddForeignKey
ALTER TABLE "orcamento_entregas_programadas" ADD CONSTRAINT "orcamento_entregas_programadas_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_entregas_programadas" ADD CONSTRAINT "orcamento_entregas_programadas_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
