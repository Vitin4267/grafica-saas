import "server-only";

// Achado B3/Parte 1 da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md) — versão CONTRATUAL/DECLARATIVA, ESCOPO DELIBERADAMENTE
// REDUZIDO (2026-09-09). Ver comentário completo no model
// OrcamentoEntregaProgramada (prisma/schema/09-orcamento.prisma) pro
// raciocínio de escopo.

// Teto de linhas por orçamento — mesmo espírito de MAX_FAIXAS_QUANTIDADE
// (src/lib/orcamento-faixas-quantidade.ts) e MAX_OPCOES_ALTERNATIVAS
// (src/lib/orcamento-opcoes.ts): impede um POST forjado com centenas de
// linhas. 24 cobre com folga o caso real ("10.000/mês por 6 meses" = 6
// linhas) até uma parcela semanal por quase meio ano.
export const MAX_ENTREGAS_PROGRAMADAS = 24;

export type LinhaCronogramaEntrega = { quantidade: number };

export type ResultadoSomaCronograma =
  | { ok: true; soma: number; completo: boolean; faltam: number }
  | { ok: false; mensagem: string };

// Critério de validação ESCOLHIDO (documentado aqui e no schema): a soma
// das linhas pode ficar ABAIXO da quantidade total do orçamento —
// cronograma ainda incompleto/parcial, aceito com aviso informativo (comum
// o vendedor cadastrar aos poucos conforme combina com o cliente, ou nunca
// preencher a última parcela porque "o resto é combinado depois") — mas
// NUNCA pode ficar ACIMA: isso prometeria entregar mais do que foi vendido
// neste orçamento, rejeitado com erro. `quantidadeTotalOrcamento` é a soma
// de `OrcamentoItem.quantidade` de todos os itens da opção-base
// (`opcaoId: null`) — ver adicionarEntregaProgramadaOrcamento
// (src/app/orcamento/[id]/actions/entrega-programada.ts). Puramente uma
// referência de validação em APP: nenhuma linha deste cronograma aponta
// pra um OrcamentoItem específico (ver comentário do model no schema).
export function validarSomaCronogramaEntrega(
  linhas: LinhaCronogramaEntrega[],
  quantidadeTotalOrcamento: number
): ResultadoSomaCronograma {
  const soma = linhas.reduce((acumulado, linha) => acumulado + linha.quantidade, 0);
  if (soma > quantidadeTotalOrcamento) {
    return {
      ok: false,
      mensagem: `A soma das quantidades do cronograma (${soma.toLocaleString("pt-BR")}) ultrapassa a quantidade total do orçamento (${quantidadeTotalOrcamento.toLocaleString("pt-BR")}).`,
    };
  }
  return {
    ok: true,
    soma,
    completo: soma === quantidadeTotalOrcamento,
    faltam: quantidadeTotalOrcamento - soma,
  };
}
