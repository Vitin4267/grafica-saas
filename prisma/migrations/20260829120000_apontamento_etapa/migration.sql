-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achados B1 e B2 da Parte 2 (Produção) da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md): avancarStatusPedido só trocava
-- Pedido.status, sem deixar nenhum rastro de quando cada etapa começou/
-- terminou, quem confirmou, nem em qual máquina o pedido rodou.
--
-- Adiciona:
-- - enum "OrigemConfirmacaoEtapa": de qual canal a transição veio (painel
--   autenticado, link público por e-mail, QR físico de chão de fábrica).
-- - tabela "apontamentos_etapa": um registro por ENTRADA numa etapa do
--   Pedido, com iniciadoEm/finalizadoEm, quem confirmou (operadorId ou
--   operadorNomeDeclarado) e em qual máquina rodou (5 FKs opcionais, mesmo
--   padrão de "registros_manutencao", mas aqui 0 preenchidas também é
--   válida — nem toda etapa tem máquina associada).
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito. Pedidos já existentes
-- ficam sem apontamento retroativo (aceitável, ver achado B1) — a linha do
-- tempo começa a partir desta migração.

-- CreateEnum
CREATE TYPE "OrigemConfirmacaoEtapa" AS ENUM ('APP', 'LINK_PUBLICO', 'QR_ETIQUETA');

-- CreateTable
CREATE TABLE "apontamentos_etapa" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "status" "StatusPedido" NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),
    "operadorId" TEXT,
    "operadorNomeDeclarado" TEXT,
    "origemConfirmacao" "OrigemConfirmacaoEtapa" NOT NULL,
    "observacao" TEXT,
    "prensaId" TEXT,
    "maquinaFlexografiaId" TEXT,
    "equipamentoId" TEXT,
    "impressoraDigitalId" TEXT,
    "maquinaSetupPorPecaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apontamentos_etapa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apontamentos_etapa_graficaId_idx" ON "apontamentos_etapa"("graficaId");

-- CreateIndex
CREATE INDEX "apontamentos_etapa_pedidoId_idx" ON "apontamentos_etapa"("pedidoId");

-- CreateIndex
CREATE INDEX "apontamentos_etapa_prensaId_idx" ON "apontamentos_etapa"("prensaId");

-- CreateIndex
CREATE INDEX "apontamentos_etapa_maquinaFlexografiaId_idx" ON "apontamentos_etapa"("maquinaFlexografiaId");

-- CreateIndex
CREATE INDEX "apontamentos_etapa_equipamentoId_idx" ON "apontamentos_etapa"("equipamentoId");

-- CreateIndex
CREATE INDEX "apontamentos_etapa_impressoraDigitalId_idx" ON "apontamentos_etapa"("impressoraDigitalId");

-- CreateIndex
CREATE INDEX "apontamentos_etapa_maquinaSetupPorPecaId_idx" ON "apontamentos_etapa"("maquinaSetupPorPecaId");

-- AddForeignKey
ALTER TABLE "apontamentos_etapa" ADD CONSTRAINT "apontamentos_etapa_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apontamentos_etapa" ADD CONSTRAINT "apontamentos_etapa_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apontamentos_etapa" ADD CONSTRAINT "apontamentos_etapa_prensaId_fkey" FOREIGN KEY ("prensaId") REFERENCES "prensas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apontamentos_etapa" ADD CONSTRAINT "apontamentos_etapa_maquinaFlexografiaId_fkey" FOREIGN KEY ("maquinaFlexografiaId") REFERENCES "maquinas_flexografia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apontamentos_etapa" ADD CONSTRAINT "apontamentos_etapa_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apontamentos_etapa" ADD CONSTRAINT "apontamentos_etapa_impressoraDigitalId_fkey" FOREIGN KEY ("impressoraDigitalId") REFERENCES "impressoras_digitais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apontamentos_etapa" ADD CONSTRAINT "apontamentos_etapa_maquinaSetupPorPecaId_fkey" FOREIGN KEY ("maquinaSetupPorPecaId") REFERENCES "maquinas_setup_por_peca"("id") ON DELETE SET NULL ON UPDATE CASCADE;
