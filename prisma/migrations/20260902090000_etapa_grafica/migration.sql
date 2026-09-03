-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A1 da auditoria de abrangência (Parte 2/Produção,
-- pesquisa-abrangencia-modulos.md, "A. Sem roteiro por produto/processo"),
-- Fase 1 (barata, resolve o gap declarado): liga/desliga e renomeia, por
-- tenant, cada um dos 8 estágios de StatusPedido que fazem parte de
-- SEQUENCIA_STATUS_PEDIDO. Antes desta migration, a sequência de produção
-- era um array literal fixo (src/lib/producao-estagios.ts) — toda gráfica,
-- digital ou serigrafia ou comunicação visual, arrastava o mesmo card por
-- "Clichê/Faca" sem jeito de desligar ou renomear a etapa.
--
-- Adiciona a tabela "etapas_grafica": uma linha por (graficaId, status),
-- com "ativa" (liga/desliga a etapa da sequência), "rotulo" (override do
-- nome padrão, null = usa o rótulo do sistema) e "ordem" (posição na
-- sequência). Bootstrap é LAZY (ver garantirEtapasGraficaPadrao em
-- src/lib/etapa-grafica.ts) — nenhuma linha é criada por esta migration;
-- uma gráfica sem nenhuma linha em "etapas_grafica" continua se comportando
-- exatamente como antes desta feature (sequência completa, rótulos
-- padrão). Migração 100% aditiva: nenhuma tabela/coluna/enum existente
-- muda de nome/tipo/obrigatoriedade, nenhum dado é reescrito.

-- CreateTable
CREATE TABLE "etapas_grafica" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "status" "StatusPedido" NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "rotulo" TEXT,
    "ordem" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etapas_grafica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "etapas_grafica_graficaId_idx" ON "etapas_grafica"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "etapas_grafica_graficaId_status_key" ON "etapas_grafica"("graficaId", "status");

-- AddForeignKey
ALTER TABLE "etapas_grafica" ADD CONSTRAINT "etapas_grafica_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
