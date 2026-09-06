-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A8 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
-- Parte 8/Clientes-Fiscal, restante pendente) — identidade visual/contato
-- própria de Filial (telefone, e-mail de contato, logo, cor primária),
-- sobrescrevendo o dado equivalente de Grafica só quando preenchida (ver
-- resolverIdentidadeVisual em src/lib/pdf/mapear-dados.ts).
--
-- 100% aditiva: 4 colunas NULLABLE novas em "filiais" (nenhuma filial
-- existente muda de comportamento — continuam caindo no dado da Grafica) +
-- 1 valor novo (LOGO_FILIAL) no enum "TipoArquivoArmazenado" já existente,
-- mesmo padrão do valor ARTE_ITEM adicionado antes (ver
-- 20260905200000_arte_item/migration.sql) — ADD VALUE só é problema pra
-- enum usado na MESMA transação em que o valor é criado, não é o caso aqui.

-- AlterTable
ALTER TABLE "filiais"
  ADD COLUMN "telefone" TEXT,
  ADD COLUMN "emailContato" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "corPrimaria" TEXT;

-- AlterEnum
ALTER TYPE "TipoArquivoArmazenado" ADD VALUE 'LOGO_FILIAL';
