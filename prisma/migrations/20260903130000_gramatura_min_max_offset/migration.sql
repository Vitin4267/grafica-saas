-- Achado N13 da auditoria de abrangência — faixa de gramatura aceita pelo
-- validador do offset (src/lib/pricing/validar.ts) deixa de ser uma
-- constante fixa 30-500 g/m² e passa a ser configurável por gráfica.
-- Defaults 30/500 preservam 100% do comportamento de hoje.
--
-- Corrigido pelo orquestrador: o subagente escreveu a migration com o nome
-- do MODEL Prisma ("ParametrosGrafica") em vez do nome real da TABELA
-- (@@map("parametros_grafica")) — teria falhado se aplicada assim.
ALTER TABLE "parametros_grafica"
  ADD COLUMN "gramaturaMinGm2" DECIMAL(6,1) NOT NULL DEFAULT 30,
  ADD COLUMN "gramaturaMaxGm2" DECIMAL(6,1) NOT NULL DEFAULT 500;
