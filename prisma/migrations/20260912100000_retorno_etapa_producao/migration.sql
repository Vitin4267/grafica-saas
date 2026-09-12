-- Migração escrita à mão (ver instrução no schema — NÃO rodar
-- `prisma migrate dev`/`migrate reset`/`migrate deploy` neste projeto, o
-- banco de dev tem dados reais de cliente).
--
-- Achado Prod-D2 da Parte 2 (Produção) da auditoria de abrangência
-- (pesquisa-abrangencia-modulos.md, "Não existe retorno de etapa: reprovado
-- só pode ser CANCELADO"): hoje avancarStatusPedido só sabe ir pra FRENTE.
-- Se a conferência de qualidade reprova um lote, a única saída era
-- cancelarPedido — que estorna TODO o estoque e mata o job inteiro, quando a
-- realidade normalmente é "volta pra impressão e roda de novo os itens que
-- saíram errados" (retrabalho), não "esse pedido nunca existiu".
--
-- 100% ADITIVA: 1 enum novo (MotivoRetorno), 3 colunas novas em
-- "apontamentos_etapa" (ehRetrabalho com DEFAULT, motivoRetorno,
-- motivoRetornoOutro), 1 coluna nova em "pedidos" (baixaEstoqueRealizadaEm)
-- COM BACKFILL (ver bloco UPDATE abaixo — leia o comentário completo, é a
-- parte mais fácil de errar desta migration). Nenhuma linha existente perde
-- dado, nenhum comportamento observável muda pra quem nunca usa
-- retornarEtapa.

-- CreateEnum
CREATE TYPE "MotivoRetorno" AS ENUM ('REPROVADO_QUALIDADE', 'ERRO_ARTE', 'MUDANCA_PEDIDO_CLIENTE', 'FALTA_MATERIAL', 'ERRO_OPERACIONAL', 'OUTRO');

-- AlterTable "apontamentos_etapa" — ehRetrabalho/motivoRetorno/
-- motivoRetornoOutro descrevem o apontamento que está sendo ABERTO por um
-- retornarEtapa (diferente de motivoRefugo, que descreve o que está sendo
-- FECHADO) — ver comentário completo no schema (model ApontamentoEtapa).
-- DEFAULT false em ehRetrabalho preserva 100% todo apontamento já existente
-- e todo apontamento aberto pelo avanço normal da FSM.
ALTER TABLE "apontamentos_etapa" ADD COLUMN "ehRetrabalho" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "apontamentos_etapa" ADD COLUMN "motivoRetorno" "MotivoRetorno";
ALTER TABLE "apontamentos_etapa" ADD COLUMN "motivoRetornoOutro" TEXT;

-- AlterTable "pedidos" — trava contra baixa DUPLICADA de matéria-prima
-- quando um pedido retorna de etapa (retornarEtapa) e reentra em PRODUCAO
-- pela sequência normal (avancarStatusPedido). Ver comentário completo no
-- schema (campo Pedido.baixaEstoqueRealizadaEm) para o raciocínio da
-- armadilha que este campo neutraliza.
ALTER TABLE "pedidos" ADD COLUMN "baixaEstoqueRealizadaEm" TIMESTAMP(3);

-- BACKFILL — leia com cuidado, é a parte mais fácil de esquecer/errar desta
-- migration.
--
-- Sem este UPDATE, todo Pedido que JÁ passou por produção antes desta
-- migration nasceria com baixaEstoqueRealizadaEm = NULL — ou seja, "ainda
-- não baixou estoque" — mesmo já tendo baixado de verdade há dias/semanas/
-- meses. Se um desses pedidos um dia passar por retornarEtapa (ex: reaberto
-- pra retrabalho) e reentrar em PRODUCAO pela sequência normal, o gate NOVO
-- em avancarStatusPedido (`!pedido.baixaEstoqueRealizadaEm`) leria NULL,
-- concluiria "primeira baixa" e descontaria a matéria-prima uma SEGUNDA vez
-- pelo material que já saiu fisicamente do estoque na primeira passagem —
-- exatamente o bug que esta migration existe pra evitar, só que reintroduzido
-- via dado histórico não migrado.
--
-- Critério (replica o comentário no schema): todo Pedido cujo status ATUAL
-- já está numa etapa POSTERIOR a PRODUCAO na sequência canônica
-- (ACABAMENTO/CONFERENCIA/EMBALAGEM/EXPEDICAO/ENTREGUE) OU que já tem
-- QUALQUER MovimentacaoEstoque tipo SAIDA_PRODUCAO vinculada (cobre também:
-- um pedido CANCELADO que chegou a entrar em produção antes de ser
-- cancelado; um pedido parado exatamente EM STATUS PRODUCAO agora, com
-- material de verdade já baixado — sem essa 2ª condição ele ficaria de fora
-- do primeiro critério, que só olha etapas ESTRITAMENTE posteriores).
--
-- Valor gravado: o createdAt da PRIMEIRA SAIDA_PRODUCAO daquele pedido
-- quando ela existe (fonte mais precisa — é o instante real em que a baixa
-- aconteceu). Quando não existe NENHUMA SAIDA_PRODUCAO pro pedido mesmo
-- assim classificado "já passou de PRODUCAO" pelo status (caso residual:
-- pedido cujos itens não tinham nenhuma matéria-prima com ficha técnica pra
-- descontar — não há nada de fato a proteger contra baixa dupla nesse caso,
-- mas o campo nasce preenchido por consistência/segurança, documentado aqui
-- como aproximação), usa Pedido."updatedAt" como aproximação — não é o
-- instante exato da baixa, mas é a melhor informação disponível sem
-- reconstruir histórico que nunca foi registrado (ApontamentoEtapa também
-- não tem backfill retroativo, ver comentário no schema).
UPDATE "pedidos" p
SET "baixaEstoqueRealizadaEm" = COALESCE(
  (
    SELECT MIN(me."createdAt")
    FROM "movimentacoes_estoque" me
    WHERE me."pedidoId" = p."id" AND me."tipo" = 'SAIDA_PRODUCAO'
  ),
  p."updatedAt"
)
WHERE p."status" IN ('ACABAMENTO', 'CONFERENCIA', 'EMBALAGEM', 'EXPEDICAO', 'ENTREGUE')
   OR EXISTS (
     SELECT 1
     FROM "movimentacoes_estoque" me2
     WHERE me2."pedidoId" = p."id" AND me2."tipo" = 'SAIDA_PRODUCAO'
   );
