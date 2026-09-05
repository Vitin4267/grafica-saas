import "server-only";
import type { DadosItemOrcamento } from "@/lib/orcamento-precificacao";

// Mesmo shape local de src/lib/orcamento-duplicar.ts — aceita tanto number
// (fixture de teste) quanto Prisma.Decimal (linha real do banco) sem
// depender do tipo gerado do Prisma aqui.
type Decimalish = string | number | { toString(): string };

// Achado B5 da auditoria de abrangência (Parte 1) — teto de linhas por item,
// mesmo espírito de MAX_OPCOES_ALTERNATIVAS (src/lib/orcamento-opcoes.ts):
// impede um POST forjado com centenas de faixas. 3 é o número clássico do
// orçamento gráfico brasileiro ("1.000/3.000/5.000"), mas a gráfica pode
// querer uma quarta/quinta pra comparar mais tiragens — teto generoso, não
// exato.
export const MAX_FAIXAS_QUANTIDADE = 6;

// Mesmo shape de ItemOrigemParaRecalculo (src/lib/orcamento-duplicar.ts), mas
// próprio: aquele helper existe pra "Pedir de novo" (orçamento NOVO, sem
// culpa em herdar o gap conhecido de nunca copiar overrides de papel/
// gramatura do Offset — um orçamento novo recalcula do zero mesmo). Uma
// FAIXA precisa ser fiel ao MESMO item que já existe — se o vendedor
// escolheu um papel/gramatura Offset diferente do produto NESTE orçamento
// (achado N8), a faixa tem que recalcular com o MESMO override, senão a
// tabela comparativa mostraria preços inconsistentes entre o item principal
// e suas próprias faixas. Por isso este type inclui precificacaoDigital/
// precificacaoOffset (que ItemOrigemParaRecalculo não tem) e não reaproveita
// montarDadosItemParaRecalculo.
export type ItemOrigemParaFaixa = {
  larguraCm: Decimalish | null;
  alturaCm: Decimalish | null;
  corFrente: number | null;
  corVerso: number | null;
  numeroCoresFlexo: number | null;
  numeroCliques: number | null;
  numeroSetups: number | null;
  numeroPontos: number | null;
  tempoEstimadoMin: Decimalish | null;
  metrosCorte: Decimalish | null;
  horasEstimadas: Decimalish | null;
  custoAquisicaoUnitario: Decimalish | null;
  // Achado N10 — coluna direta em OrcamentoItem (hoje só OFFSET grava aqui,
  // fora do M2 com clichê de etiqueta, que usa precificacaoEtiqueta.custoFaca
  // abaixo — ver comentário em OrcamentoItem.custoFaca no schema).
  custoFaca: Decimalish | null;
  materialFornecidoPeloCliente: boolean;
  acabamentos: { itemGraficaId: string }[];
  precificacaoEtiqueta: {
    papelId: string;
    quantidadeCores: number;
    custoFaca: Decimalish | null;
    custoFrete: Decimalish | null;
  } | null;
  // Achado N4 — papel escolhido NESTE orçamento pro motor Digital.
  precificacaoDigital: { papelId: string } | null;
  // Achado N8 — papel/gramatura OVERRIDDEN neste orçamento pro motor Offset.
  precificacaoOffset: { papelId: string | null; gramaturaGm2: Decimalish | null } | null;
};

// Reconstrói os dados de ENTRADA que calcularItemOrcamento precisa pra
// recalcular a MESMA configuração do item, só trocando a quantidade — usado
// por adicionarFaixaQuantidadeOrcamento (src/app/orcamento/[id]/actions/faixas.ts)
// pra gerar cada linha da tabela comparativa ("1.000/3.000/5.000 unidades").
// margemLucroOverride é passado à parte (propriedade do CLIENTE do
// orçamento, não do item — mesmo padrão de montarDadosItemParaRecalculo em
// src/lib/orcamento-duplicar.ts).
export function montarDadosParaFaixa(
  item: ItemOrigemParaFaixa,
  quantidade: number,
  margemLucroOverride: number | null
): DadosItemOrcamento {
  return {
    quantidade,
    larguraCm: item.larguraCm !== null ? Number(item.larguraCm) : null,
    alturaCm: item.alturaCm !== null ? Number(item.alturaCm) : null,
    corFrente: item.corFrente,
    corVerso: item.corVerso,
    numeroCoresFlexo: item.numeroCoresFlexo,
    numeroCliques: item.numeroCliques,
    numeroSetups: item.numeroSetups,
    numeroPontos: item.numeroPontos,
    tempoEstimadoMin: item.tempoEstimadoMin !== null ? Number(item.tempoEstimadoMin) : null,
    metrosCorte: item.metrosCorte !== null ? Number(item.metrosCorte) : null,
    horasEstimadas: item.horasEstimadas !== null ? Number(item.horasEstimadas) : null,
    custoAquisicaoUnitario:
      item.custoAquisicaoUnitario !== null ? Number(item.custoAquisicaoUnitario) : null,
    materialFornecidoPeloCliente: item.materialFornecidoPeloCliente,
    acabamentoIds: item.acabamentos.map((a) => a.itemGraficaId),
    // papelId é o mesmo campo compartilhado pelos 3 motores (clichê de
    // etiqueta, Digital, Offset override) — nunca dois populados ao mesmo
    // tempo, já que modeloCalculo é mutuamente exclusivo (mesmo raciocínio
    // de DadosItemOrcamento.papelId em orcamento-precificacao.ts).
    papelId:
      item.precificacaoEtiqueta?.papelId ??
      item.precificacaoDigital?.papelId ??
      item.precificacaoOffset?.papelId ??
      null,
    quantidadeCores: item.precificacaoEtiqueta?.quantidadeCores ?? null,
    // Achado N10 — precificacaoEtiqueta.custoFaca é a fonte de verdade pra
    // M2 com clichê; item.custoFaca (coluna direta, hoje só OFFSET) é o
    // fallback pra todo o resto — mesma prioridade de montarDadosItemParaRecalculo.
    custoFaca:
      item.precificacaoEtiqueta?.custoFaca != null
        ? Number(item.precificacaoEtiqueta.custoFaca)
        : item.custoFaca != null
          ? Number(item.custoFaca)
          : null,
    custoFrete:
      item.precificacaoEtiqueta?.custoFrete != null ? Number(item.precificacaoEtiqueta.custoFrete) : null,
    // Achado N8 — diferente de montarDadosItemParaRecalculo (que sempre usa
    // null aqui, gap conhecido só aceitável pra "Pedir de novo"), uma faixa
    // do MESMO item precisa preservar o override de gramatura já escolhido
    // neste orçamento, senão a faixa recalcularia com a gramatura FIXA do
    // produto enquanto o item principal usa a override — inconsistência
    // visível na própria tabela comparativa.
    gramaturaGm2:
      item.precificacaoOffset?.gramaturaGm2 != null ? Number(item.precificacaoOffset.gramaturaGm2) : null,
    margemLucroOverride,
  };
}
