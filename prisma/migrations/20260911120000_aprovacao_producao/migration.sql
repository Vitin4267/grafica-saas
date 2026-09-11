-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado D1 da Parte 2 (Produção) da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "Não existe aprovação intermediária
-- dentro da produção"): existia aprovação de ARTE (pré-produção, voltada ao
-- CLIENTE — Pedido.arteUrl/arteAprovadaEm/arteLinkToken), mas nada DENTRO da
-- produção — nenhum "aprovar a primeira folha antes de rodar as outras 20
-- mil", nenhuma inspeção final registrada, nenhuma foto de conferência.
--
-- CORREÇÃO ao texto original da proposta (verificada nesta sessão): a
-- proposta amarrava o gate a EtapaFluxo.exigeAprovacaoQualidade, campo de um
-- model de "Fase 2" estrutural (achado A1) NUNCA construído. Esta migration
-- usa EtapaGrafica (JÁ EXISTE, model 20260821230000_...) em vez disso — já
-- dá a granularidade certa (uma linha por status/etapa de cada gráfica), sem
-- precisar de nenhum model novo de "fluxo".
--
-- ESCOPO DELIBERADAMENTE REDUZIDO — ver comentário completo no schema
-- (model AprovacaoProducao / enum TipoAprovacaoProducao): os 5 tipos
-- internos (OK_MAQUINA, PROVA_CONTRATO, INSPECAO_PROCESSO, INSPECAO_FINAL,
-- OUTRO) são construídos de verdade (fluxo interno completo, registrado por
-- um usuário do sistema). AMOSTRA_CLIENTE (BAT/boneco físico aprovado pelo
-- CLIENTE via link público) fica cadastrado no enum mas SEM nenhuma tela
-- pública/token nesta rodada — fora de escopo deliberado, documentado no
-- schema.
--
-- 100% ADITIVA: 2 enums novos, 1 tabela nova, 1 coluna nova (com DEFAULT)
-- em "etapas_grafica", 1 valor novo num enum já existente
-- (TipoArquivoArmazenado). Nenhuma linha existente é tocada; uma gráfica que
-- nunca liga EtapaGrafica.exigeAprovacaoQualidade continua 100% igual a
-- hoje (ver gate opt-in em avancarStatusPedido, src/app/producao/status-transicao.ts).

-- CreateEnum
CREATE TYPE "TipoAprovacaoProducao" AS ENUM ('OK_MAQUINA', 'PROVA_CONTRATO', 'AMOSTRA_CLIENTE', 'INSPECAO_PROCESSO', 'INSPECAO_FINAL', 'OUTRO');

-- CreateEnum
CREATE TYPE "ResultadoAprovacao" AS ENUM ('APROVADO', 'APROVADO_COM_RESSALVA', 'REPROVADO');

-- AlterEnum (foto opcional anexada a uma AprovacaoProducao — ver comentário
-- completo no schema, TipoArquivoArmazenado.FOTO_APROVACAO_PRODUCAO)
ALTER TYPE "TipoArquivoArmazenado" ADD VALUE 'FOTO_APROVACAO_PRODUCAO';

-- AlterTable (gate opt-in — @default(false) preserva 100% o comportamento
-- de toda EtapaGrafica já existente)
ALTER TABLE "etapas_grafica" ADD COLUMN "exigeAprovacaoQualidade" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "aprovacoes_producao" (
    "id" TEXT NOT NULL,
    "graficaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "apontamentoEtapaId" TEXT,
    "tipo" "TipoAprovacaoProducao" NOT NULL,
    "tipoOutro" TEXT,
    "resultado" "ResultadoAprovacao" NOT NULL,
    "aprovadoPorId" TEXT,
    "aprovadoPorNomeDeclarado" TEXT,
    "arquivoId" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aprovacoes_producao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aprovacoes_producao_graficaId_pedidoId_idx" ON "aprovacoes_producao"("graficaId", "pedidoId");

-- CreateIndex
CREATE INDEX "aprovacoes_producao_apontamentoEtapaId_idx" ON "aprovacoes_producao"("apontamentoEtapaId");

-- CreateIndex
CREATE INDEX "aprovacoes_producao_aprovadoPorId_idx" ON "aprovacoes_producao"("aprovadoPorId");

-- CreateIndex
CREATE INDEX "aprovacoes_producao_arquivoId_idx" ON "aprovacoes_producao"("arquivoId");

-- AddForeignKey
ALTER TABLE "aprovacoes_producao" ADD CONSTRAINT "aprovacoes_producao_graficaId_fkey" FOREIGN KEY ("graficaId") REFERENCES "graficas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprovacoes_producao" ADD CONSTRAINT "aprovacoes_producao_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprovacoes_producao" ADD CONSTRAINT "aprovacoes_producao_apontamentoEtapaId_fkey" FOREIGN KEY ("apontamentoEtapaId") REFERENCES "apontamentos_etapa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprovacoes_producao" ADD CONSTRAINT "aprovacoes_producao_aprovadoPorId_fkey" FOREIGN KEY ("aprovadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprovacoes_producao" ADD CONSTRAINT "aprovacoes_producao_arquivoId_fkey" FOREIGN KEY ("arquivoId") REFERENCES "arquivos_armazenados"("id") ON DELETE SET NULL ON UPDATE CASCADE;
