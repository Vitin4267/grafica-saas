-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achados A4 e A6 da Parte 1 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "Achados no Catálogo / motor de preço"):
--
-- A4 — Bordado só existia como SERVICO no catálogo mestre, sem motor de
-- cálculo: encaixar em SERIGRAFIA/setup-por-peça falha porque em bordado o
-- custo por peça varia com o número de PONTOS da arte de cada pedido (não é
-- fixo por máquina, como custoPorPeca de MaquinaSetupPorPeca assume).
--
-- A6 — Corte/gravação a laser, router CNC, plotter de recorte, montagem de
-- letra caixa/totem: nenhum modelo cobra por TEMPO DE MÁQUINA. Equipamento
-- (CategoriaEquipamento.CORTE_LASER_ROUTER/PLOTTER_RECORTE) existe só como
-- cadastro informativo, nunca influencia preço.
--
-- Adiciona:
-- - ModeloCalculo.BORDADO e ModeloCalculo.TEMPO_MAQUINA (11º e 12º rótulo).
-- - tabela "maquinas_bordado": custoPorMilPontos, custoMatrizDigitalizacao,
--   cabecas, custoHoraMaq opcional, custoMinimo opcional — mesmo padrão de
--   FK/índice/@@map de "maquinas_setup_por_peca".
-- - tabela "maquinas_tempo": custoHoraMaq, custoSetupPorJob, custoMinimo
--   opcional, custoPorMetroCorte opcional — mesmo padrão.
-- - colunas "maquinaBordadoId"/"maquinaTempoId" em "itens_grafica" (mesmo
--   padrão de "maquinaSetupPorPecaId", onDelete=Restrict — não deixa excluir
--   uma máquina ainda em uso por algum produto).
-- - colunas em "orcamento_itens": "numeroPontos" (nº de pontos da arte de
--   bordado, driver de custo POR PEDIDO — achado A4) e
--   "tempoEstimadoMin"/"metrosCorte" (base de cobrança de TEMPO_MAQUINA,
--   escolhida pela gráfica na máquina — achado A6).
--
-- Migração 100% aditiva: nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado é reescrito. Todo produto/item de
-- orçamento já existente fica com modeloCalculo/máquina/campos novos em
-- NULL (comportamento de hoje 100% preservado) e nenhuma gráfica tem nenhuma
-- MaquinaBordado/MaquinaTempo cadastrada até que alguém crie uma pela nova
-- tela em /configuracoes/maquinas.

-- AlterEnum
ALTER TYPE "ModeloCalculo" ADD VALUE 'BORDADO';
ALTER TYPE "ModeloCalculo" ADD VALUE 'TEMPO_MAQUINA';

-- CreateTable
CREATE TABLE "maquinas_bordado" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "custoPorMilPontos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "custoMatrizDigitalizacao" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cabecas" INTEGER NOT NULL DEFAULT 1,
    "custoHoraMaq" DECIMAL(10,2),
    "custoMinimo" DECIMAL(10,2),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maquinas_bordado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maquinas_tempo" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "custoHoraMaq" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "custoSetupPorJob" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "custoMinimo" DECIMAL(10,2),
    "custoPorMetroCorte" DECIMAL(10,2),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maquinas_tempo_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "itens_grafica" ADD COLUMN     "maquinaBordadoId" TEXT,
ADD COLUMN     "maquinaTempoId" TEXT;

-- AlterTable
ALTER TABLE "orcamento_itens" ADD COLUMN     "numeroPontos" INTEGER,
ADD COLUMN     "tempoEstimadoMin" DECIMAL(10,2),
ADD COLUMN     "metrosCorte" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "maquinas_bordado_graficaId_idx" ON "maquinas_bordado"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "maquinas_bordado_graficaId_nome_key" ON "maquinas_bordado"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "maquinas_tempo_graficaId_idx" ON "maquinas_tempo"("graficaId");

-- CreateIndex
CREATE UNIQUE INDEX "maquinas_tempo_graficaId_nome_key" ON "maquinas_tempo"("graficaId", "nome");

-- CreateIndex
CREATE INDEX "itens_grafica_maquinaBordadoId_idx" ON "itens_grafica"("maquinaBordadoId");

-- CreateIndex
CREATE INDEX "itens_grafica_maquinaTempoId_idx" ON "itens_grafica"("maquinaTempoId");

-- AddForeignKey
ALTER TABLE "maquinas_bordado" ADD CONSTRAINT "maquinas_bordado_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maquinas_tempo" ADD CONSTRAINT "maquinas_tempo_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_maquinaBordadoId_fkey" FOREIGN KEY ("maquinaBordadoId") REFERENCES "maquinas_bordado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_grafica" ADD CONSTRAINT "itens_grafica_maquinaTempoId_fkey" FOREIGN KEY ("maquinaTempoId") REFERENCES "maquinas_tempo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
