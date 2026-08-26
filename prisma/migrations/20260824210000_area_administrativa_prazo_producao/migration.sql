-- Migração escrita à mão (drift do Prisma por causa da tabela n8n_chatbot,
-- fora do controle de migrations — NÃO rodar `prisma migrate reset`).
--
-- Achado A9 da auditoria de abrangência (pesquisa-abrangencia-modulos.md):
-- o alerta de prazo/atraso de pedido (src/lib/alerta-prazo-email.ts) sempre
-- mandava e-mail pro vendedor do orçamento + TODOS os DONOs da gráfica,
-- hardcoded — sem jeito de rotear pra um PCP dedicado numa gráfica maior
-- sem promovê-lo a DONO. O mecanismo de "responsável administrativo"
-- (enum AreaAdministrativa + model ResponsavelAdministrativo) já existe e
-- já resolve exatamente esse tipo de roteamento pra NOTA_FISCAL — só falta
-- um segundo valor no enum, PRAZO_PRODUCAO, pra reaproveitar o mesmo
-- mecanismo aqui.
--
-- Operação aditiva (ADD VALUE) e não quebra nenhum tenant existente: nenhum
-- valor de enum existente muda de nome. Gráfica que nunca configurar nenhum
-- responsável de PRAZO_PRODUCAO mantém o comportamento de hoje (vendedor +
-- todos os DONOs) via fallback em src/lib/alerta-prazo-email.ts.

-- AlterEnum
ALTER TYPE "AreaAdministrativa" ADD VALUE 'PRAZO_PRODUCAO';
