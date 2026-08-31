-- AlterEnum
-- Achado A9 da auditoria de abrangência (pesquisa-abrangencia-modulos.md),
-- restante pendente: adiciona COBRANCA (alerta de conta a receber vencida —
-- reservado, nenhum disparo de e-mail existe hoje pra rotear) e COMPRAS
-- (alerta de estoque crítico, src/lib/alerta-estoque.ts) ao enum
-- AreaAdministrativa, seguindo o mesmo padrão já usado por PRAZO_PRODUCAO.
ALTER TYPE "AreaAdministrativa" ADD VALUE 'COBRANCA';
ALTER TYPE "AreaAdministrativa" ADD VALUE 'COMPRAS';
