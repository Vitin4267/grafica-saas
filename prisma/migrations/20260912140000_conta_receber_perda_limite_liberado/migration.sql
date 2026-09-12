-- Achado N23 da Parte 9 da auditoria de código (2026-09-12) — write-off de
-- ContaReceber (status=PERDA) passa a distinguir "reconhecido como calote"
-- de "limite de crédito liberado pro cliente comprar a prazo de novo", que
-- até aqui eram a MESMA coisa (marcar PERDA liberava o limite na hora).
-- Aditivo: 2 colunas nullable, sem default diferente de NULL, sem backfill
-- — toda ContaReceber existente continua com os dois campos NULL (nenhuma
-- perda antiga é retroativamente "revisada" ou re-somada na DRE).
ALTER TABLE "contas_a_receber" ADD COLUMN "perdaEm" TIMESTAMP(3);
ALTER TABLE "contas_a_receber" ADD COLUMN "limiteLiberadoEm" TIMESTAMP(3);
