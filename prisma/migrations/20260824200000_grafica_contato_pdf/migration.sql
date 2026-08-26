-- Achado A8 (parte 1) da auditoria de abrangência (pesquisa-abrangencia-modulos.md) —
-- O PDF de orçamento que a gráfica manda pro cliente não tem CNPJ, endereço,
-- telefone nem e-mail, impossibilitando o cliente de responder fora do link.
--
-- Adiciona 4 campos de contato COMERCIAIS (não fiscais, ver DadosFiscaisGrafica)
-- ao nível da GRÁFICA — aparecem no rodapé do PDF de orçamento
-- (src/lib/pdf/OrcamentoDocumento.tsx) junto com logo/corPrimaria.
-- Todos nullable, aditivos — zero impacto em gráficas já existentes.

-- AlterTable
ALTER TABLE "graficas" ADD COLUMN "telefone" TEXT, ADD COLUMN "emailContato" TEXT, ADD COLUMN "site" TEXT, ADD COLUMN "enderecoResumido" TEXT;
