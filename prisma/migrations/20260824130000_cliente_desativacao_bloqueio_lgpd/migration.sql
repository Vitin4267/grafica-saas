-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado A9 da auditoria de abrangência: Cliente só podia ser excluído
-- (hard delete), e a exclusão falhava justamente quando havia orçamento
-- vinculado — o caso mais comum. Adiciona desativação reversível (mesmo
-- precedente de Usuario.desativadoEm), bloqueio de venda por inadimplência
-- e updatedAt, pra viabilizar soft-delete + anonimização LGPD em vez de
-- "fale com o suporte".
--
-- Todas as colunas são aditivas e não quebram nenhum tenant existente:
-- desativadoEm/motivoBloqueio nascem NULL (cliente ativo, sem bloqueio),
-- bloqueadoParaVenda nasce false, updatedAt recebe CURRENT_TIMESTAMP pras
-- linhas existentes.

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "desativadoEm" TIMESTAMP(3),
ADD COLUMN     "bloqueadoParaVenda" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "motivoBloqueio" TEXT;
