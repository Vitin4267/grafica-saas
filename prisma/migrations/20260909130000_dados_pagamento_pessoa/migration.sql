-- Migracao escrita a mao (ver instrucao no schema -- NAO rodar
-- `prisma migrate dev`/`migrate reset` neste projeto, o banco de dev tem
-- dados reais de cliente).
--
-- Achado D3 da auditoria de abrangencia (Parte 7/Pessoas,
-- pesquisa-abrangencia-modulos.md, 2026-09-09): faltava onde a grafica
-- registra PRA ONDE PAGAR uma pessoa (funcionario/colaborador que ela
-- precisa pagar -- comissao, freelancer, motorista). Nao ha sobreposicao
-- com F6 (Grafica.chavePix -- e a chave da GRAFICA pra RECEBER do
-- cliente, sentido oposto) nem com A15 (ContaFinanceira -- "onde o
-- dinheiro esta", sem dado de pessoa nenhum).
--
-- Adiciona (100% aditivo, nenhuma tabela/coluna/enum existente muda de
-- nome/tipo/obrigatoriedade, nenhum dado e reescrito):
-- - "usuarios": cpf, chavePix, tipoChavePix (reaproveita o enum
--   TipoChavePix ja existente, criado pro achado F6), especialidade --
--   todos nullable, todo Usuario existente fica com estes campos em NULL
--   (comportamento de hoje 100% preservado).
-- - "colaboradores": os MESMOS 4 campos, mesmo motivo -- Colaborador
--   (motorista/freelancer/operador sem login) e quem mais recebe
--   pagamento avulso na pratica.
--
-- SO EXIBICAO: cpf/chavePix nunca sao validados (mesmo raciocinio ja
-- documentado no comentario de Grafica.chavePix, 01-grafica.prisma) --
-- texto livre, sem checar digito verificador de CPF nem formato de
-- e-mail/telefone. Exposicao controlada em codigo (nao em banco): so
-- aparecem em /usuarios (edicao) e /configuracoes/colaboradores/[id]
-- (edicao), ambos gated pela permissao FINANCEIRO, e em
-- /financeiro/comissoes (exibicao, mesmo gate) -- nunca em listagem geral
-- nem em PDF algum.

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "chavePix" TEXT,
ADD COLUMN     "tipoChavePix" "TipoChavePix",
ADD COLUMN     "especialidade" TEXT;

-- AlterTable
ALTER TABLE "colaboradores" ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "chavePix" TEXT,
ADD COLUMN     "tipoChavePix" "TipoChavePix",
ADD COLUMN     "especialidade" TEXT;
