-- Expande TipoFrete pros 6 valores oficiais de modFrete do layout NF-e 4.0
-- (achado B1 da auditoria de abrangência) — antes só cobria CIF/FOB
-- (modFrete 0/1), faltando principalmente SEM_FRETE (modFrete 9 = "Sem
-- Ocorrência de Transporte"), que é o caso mais comum de gráfica rápida
-- (retirada no balcão).
--
-- Usa RENAME VALUE (não recria o enum do zero) pros 2 valores que já
-- existiam — isso preserva o dado de TODO orçamento já salvo
-- automaticamente, sem UPDATE nenhum e sem nenhuma janela em que um
-- orçamento fique com um frete inválido:
--   EMITENTE     -> CIF_REMETENTE     (modFrete 0)
--   DESTINATARIO -> FOB_DESTINATARIO  (modFrete 1)
--
-- TERCEIROS, PROPRIO_REMETENTE, PROPRIO_DESTINATARIO e SEM_FRETE são
-- valores totalmente novos, sem orçamento nenhum usando ainda — ADD VALUE
-- só declara o rótulo válido pra orçamentos que usarem dali em diante.
ALTER TYPE "TipoFrete" RENAME VALUE 'EMITENTE' TO 'CIF_REMETENTE';
ALTER TYPE "TipoFrete" RENAME VALUE 'DESTINATARIO' TO 'FOB_DESTINATARIO';

ALTER TYPE "TipoFrete" ADD VALUE 'TERCEIROS' AFTER 'FOB_DESTINATARIO';
ALTER TYPE "TipoFrete" ADD VALUE 'PROPRIO_REMETENTE' AFTER 'TERCEIROS';
ALTER TYPE "TipoFrete" ADD VALUE 'PROPRIO_DESTINATARIO' AFTER 'PROPRIO_REMETENTE';
ALTER TYPE "TipoFrete" ADD VALUE 'SEM_FRETE' AFTER 'PROPRIO_DESTINATARIO';
