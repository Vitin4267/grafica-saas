-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado A1 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
-- Parte 5): não existia distinção Pessoa Física × Pessoa Jurídica no
-- cadastro de cliente, e por isso faltavam razão social, Inscrição Estadual
-- e indicador de contribuinte de ICMS do destinatário — a emissão de NF-e
-- nunca conseguia mandar `inscricao_estadual_destinatario` nem
-- `indicador_inscricao_estadual_destinatario` (campos exigidos pela SEFAZ:
-- rejeição 728 se faltar IE com indicador=contribuinte, rejeição 791 se vier
-- IE com indicador=isento).
--
-- Adiciona:
-- - enum TipoPessoa (FISICA/JURIDICA, sem OUTRO: não existe terceiro tipo).
-- - enum IndicadorInscricaoEstadual (CONTRIBUINTE/ISENTO/NAO_CONTRIBUINTE —
--   tag indIEDest da NF-e 4.0).
-- - clientes.tipoPessoa: NULL = cadastro antigo, sem mudança de comportamento.
-- - clientes.razaoSocial/nomeFantasia: `clientes.nome` continua sendo o
--   rótulo de uso interno (nunca migrado/apagado); a emissão fiscal passa a
--   preferir razaoSocial ?? nome.
-- - clientes.inscricaoEstadual/indicadorInscricaoEstadual.
-- - clientes.inscricaoMunicipal: campo do tomador que qualquer NFS-e
--   municipal pede — barato guardar agora mesmo sem uso imediato.
--
-- Todas as colunas são aditivas e nascem NULL — não quebram nenhum tenant
-- existente.

-- CreateEnum
CREATE TYPE "TipoPessoa" AS ENUM ('FISICA', 'JURIDICA');

-- CreateEnum
CREATE TYPE "IndicadorInscricaoEstadual" AS ENUM ('CONTRIBUINTE', 'ISENTO', 'NAO_CONTRIBUINTE');

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "tipoPessoa" "TipoPessoa",
ADD COLUMN     "razaoSocial" TEXT,
ADD COLUMN     "nomeFantasia" TEXT,
ADD COLUMN     "inscricaoEstadual" TEXT,
ADD COLUMN     "indicadorInscricaoEstadual" "IndicadorInscricaoEstadual",
ADD COLUMN     "inscricaoMunicipal" TEXT;
