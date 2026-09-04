-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado R3 da auditoria de abrangência (Parte 2/Produção, rodada 20,
-- 2026-09-03, resíduo do achado E1/Parte 2): EtapaTerceirizada registrava
-- envio/retorno mas não tinha como EMITIR a NF-e de remessa pra
-- industrialização (CFOP 5901/6901) direto do sistema — notaRemessa/
-- notaRetorno eram só texto livre pro número de uma nota emitida fora do
-- sistema.
--
-- Adiciona:
-- - colunas de endereço/documento fiscal em "fornecedores", opcionais,
--   necessárias pra usar um Fornecedor cadastrado como DESTINATÁRIO de uma
--   NF-e de remessa (ver fornecedorProntoParaNfe em src/lib/nota-fiscal.ts).
-- - colunas "remessaNfe*" em "etapas_terceirizadas": resultado ESTRUTURADO
--   da emissão da NF-e de remessa via Focus NFe (status/número/série/chave/
--   XML/DANFE/mensagem de erro), espelhando os campos de "notas_fiscais"
--   mas FLAT nesta própria tabela — NotaFiscal é 1:1 com Orcamento
--   (orcamentoId NOT NULL UNIQUE) e não existe Orcamento nenhum pra uma
--   remessa de terceirização. Só a REMESSA: o RETORNO (CFOP 5902/6902) é
--   fiscalmente uma saída do ESTABELECIMENTO TERCEIRIZADO, não da gráfica —
--   ver comentário completo no schema.prisma, model EtapaTerceirizada.
--
-- Migração 100% aditiva: nenhuma tabela/coluna existente muda de
-- tipo/obrigatoriedade, nenhum dado é reescrito.

-- AlterTable
ALTER TABLE "fornecedores"
    ADD COLUMN "documento" TEXT,
    ADD COLUMN "enderecoLogradouro" TEXT,
    ADD COLUMN "enderecoNumero" TEXT,
    ADD COLUMN "enderecoBairro" TEXT,
    ADD COLUMN "enderecoMunicipio" TEXT,
    ADD COLUMN "enderecoUf" TEXT,
    ADD COLUMN "enderecoCep" TEXT;

-- AlterTable
ALTER TABLE "etapas_terceirizadas"
    ADD COLUMN "remessaNfeStatus" "StatusNotaFiscal",
    ADD COLUMN "remessaNfeNumero" TEXT,
    ADD COLUMN "remessaNfeSerie" TEXT,
    ADD COLUMN "remessaNfeChaveAcesso" TEXT,
    ADD COLUMN "remessaNfeXmlUrl" TEXT,
    ADD COLUMN "remessaNfeDanfeUrl" TEXT,
    ADD COLUMN "remessaNfeMensagemErro" TEXT;
