-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado A5 da Parte 4 da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "régua de cobrança + juros/multa") —
-- ESCOPO DELIBERADAMENTE REDUZIDO: só as fatias 1 e 2 da proposta original.
-- A fatia 3 (model ReguaCobrancaEtapa com disparo automático de e-mail/
-- webhook escalonado pro cliente final do tenant) foi DELIBERADAMENTE
-- DEIXADA DE FORA — decisão de produto sensível (tom, canal, opt-out) que
-- precisa de aprovação humana explícita antes de construir. Nenhum model,
-- cron ou disparo automático de cobrança foi criado nesta migration.
--
-- 1) Fatia 1 — status honesto: 2 novos valores de StatusContaReceber
--    (EM_COBRANCA, PERDA). ADD VALUE aditivo, nenhum valor antigo removido/
--    renomeado (mesmo cuidado documentado em 20260908140000_taxa_forma_
--    pagamento pra FormaPagamento). Nenhuma transição automática — sempre o
--    usuário marcando manualmente (ver marcarContaReceberEmCobranca/
--    marcarContaReceberPerda em src/app/financeiro/contas-receber/
--    actions.ts). Nenhum valor novo é usado em INSERT/UPDATE desta própria
--    migration, então não há problema de "ADD VALUE dentro da transação que
--    já usa o valor".
--
-- 2) Fatia 2 — juros/multa informados na baixa (nunca calculados sozinhos):
--    - ParametrosGrafica.multaAtrasoPercent (DECIMAL(5,2) NOT NULL DEFAULT 2)
--      e jurosMoraMensalPercent (DECIMAL(5,2) NOT NULL DEFAULT 1) — só
--      SUGESTÃO exibida na tela de baixa, nunca aplicados automaticamente.
--      Defaults preservam o comportamento de hoje pra toda gráfica já
--      cadastrada (campo puramente informativo até o usuário usar).
--    - Pagamento.valorJuros / Pagamento.valorMulta (DECIMAL(12,2) NOT NULL
--      DEFAULT 0) — quanto de juros/multa foi de fato cobrado neste
--      pagamento, digitado pelo usuário na baixa (pode vir pré-preenchido a
--      partir dos percentuais acima × dias de atraso, sempre editável).
--      @default(0) aditivo: todo Pagamento existente e todo Pagamento novo
--      sem preencher estes campos continua se comportando EXATAMENTE como
--      hoje. Vira receita financeira, linha própria no DRE (src/lib/dre.ts/
--      dre-query.ts) — NUNCA somado em cima de Orcamento.total, pra não
--      inflar a receita bruta reconhecida por competência.

-- AlterEnum
ALTER TYPE "StatusContaReceber" ADD VALUE 'EM_COBRANCA';
ALTER TYPE "StatusContaReceber" ADD VALUE 'PERDA';

-- AlterTable
ALTER TABLE "parametros_grafica" ADD COLUMN     "multaAtrasoPercent" DECIMAL(5,2) NOT NULL DEFAULT 2,
ADD COLUMN     "jurosMoraMensalPercent" DECIMAL(5,2) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "valorJuros" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "valorMulta" DECIMAL(12,2) NOT NULL DEFAULT 0;
