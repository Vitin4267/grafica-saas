-- AlterTable
ALTER TABLE "assinatura_grafica" ADD COLUMN     "inadimplenteDesde" TIMESTAMP(3);

-- Backfill: quem já está INADIMPLENTE hoje não tem histórico de quando isso
-- começou (o campo não existia antes). Marcar "agora" dá a eles a carência
-- de 2 meses inteira a partir do deploy, em vez de ficarem sem carência
-- nenhuma até o próximo evento do Stripe resincronizar o status.
UPDATE "assinatura_grafica" SET "inadimplenteDesde" = NOW() WHERE "status" = 'INADIMPLENTE';
