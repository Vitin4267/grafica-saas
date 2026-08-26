-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado A3 da auditoria de abrangência: DadosFiscaisGrafica.cfopPadrao
-- nasce "5102" (venda dentro do estado) e era usado tal e qual em TODA
-- emissão de NF-e, sem comparar a UF da gráfica/filial com a UF do cliente
-- — a primeira nota pra um cliente de outro estado saía com CFOP interno
-- errado. Adiciona um segundo default, específico pra venda interestadual,
-- usado por resolverCfop (src/lib/nota-fiscal.ts) quando as UFs divergem.
-- Não distingue cliente contribuinte/não-contribuinte de ICMS (6102 vs
-- 6108) — gap remanescente, depende do indicador de contribuinte do
-- cliente (achado A1, campo ainda não existe no schema).
--
-- Coluna aditiva e não quebra nenhum tenant existente: toda linha já
-- existente ganha "6102" automaticamente via DEFAULT.

-- AlterTable
ALTER TABLE "dados_fiscais_grafica" ADD COLUMN     "cfopPadraoInterestadual" TEXT NOT NULL DEFAULT '6102';

-- AlterTable
ALTER TABLE "dados_fiscais_filial" ADD COLUMN     "cfopPadraoInterestadual" TEXT NOT NULL DEFAULT '6102';
