-- Achado A13 da Parte 6 da auditoria de abrangência (2026-08-29)
-- Adiciona campo estruturado de tolerância de tiragem em ParametrosGrafica
-- para configuração de política comercial padrão.

ALTER TABLE "parametros_grafica" ADD COLUMN "toleranciaTiragemPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
