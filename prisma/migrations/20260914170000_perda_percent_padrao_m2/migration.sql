-- Achado A8 da auditoria de abrangência (2026-09-14) — M2 era o único motor
-- de precificação sem desconto de perda de material. OFFSET e FLEXOGRAFIA já
-- descontam perda no nível de MÁQUINA (Prensa/MaquinaFlexografia); M2 não
-- tem máquina própria, então o default é por gráfica (ParametrosGrafica).
-- Aditivo: 1 coluna com default (mesmo 0.03 = 3% dos dois motores irmãos),
-- nunca NULL — toda linha existente de ParametrosGrafica ganha o valor
-- default automaticamente, sem quebrar nenhum orçamento M2 já calculado
-- (cálculos passados não são recalculados, só orçamentos NOVOS a partir de
-- agora passam a descontar perda).
ALTER TABLE "parametros_grafica" ADD COLUMN "perdaPercentPadraoM2" DECIMAL(5,4) NOT NULL DEFAULT 0.03;
