import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AncoraVencimento } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { dataInputParaUTC, hojeBrasiliaInputValue } from "@/lib/data";

export type ParcelaCondicaoPagamentoSugerida = {
  ordem: number;
  percentual: number;
  diasAposAncora: number;
};

export type CondicaoPagamentoSugerida = {
  nome: string;
  ancora: AncoraVencimento;
  acrescimoPercent?: number;
  parcelas: ParcelaCondicaoPagamentoSugerida[];
};

// Pesquisa de mercado do achado A7 da Parte 4 (pesquisa-abrangencia-modulos.md,
// 2026-08-28) — as 4 condições mais praticadas por gráfica brasileira. Só
// PONTO DE PARTIDA (mesmo princípio de CATEGORIAS_CUSTO_SUGERIDAS em
// src/lib/custo-pedido.ts): a gráfica é livre pra renomear/desativar/criar
// as suas próprias depois de bootada, nunca fixo em código daqui pra frente.
//
// "50% + 50% na entrega" merece nota: na prática essa condição mistura duas
// âncoras (entrada na aprovação do pedido, saldo na entrega), mas o model
// CondicaoPagamento só suporta UMA âncora por condição, todas as parcelas
// compartilhando (ver proposta do achado). Modelada aqui com as duas
// parcelas ancoradas em ENTREGA — metade no ato, metade 30 dias depois —
// em vez de inventar um "meio termo" ambíguo. Decisão documentada aqui e no
// relatório final do achado, não uma leitura escondida.
export const CONDICOES_PAGAMENTO_SUGERIDAS: CondicaoPagamentoSugerida[] = [
  {
    nome: "1x faturado 30 dias",
    ancora: "EMISSAO_NOTA",
    parcelas: [{ ordem: 1, percentual: 100, diasAposAncora: 30 }],
  },
  {
    nome: "50% + 50% na entrega",
    ancora: "ENTREGA",
    parcelas: [
      { ordem: 1, percentual: 50, diasAposAncora: 0 },
      { ordem: 2, percentual: 50, diasAposAncora: 30 },
    ],
  },
  {
    nome: "30/60/90 com 2% de acréscimo",
    ancora: "APROVACAO",
    acrescimoPercent: 2,
    parcelas: [
      { ordem: 1, percentual: 33.34, diasAposAncora: 30 },
      { ordem: 2, percentual: 33.33, diasAposAncora: 60 },
      { ordem: 3, percentual: 33.33, diasAposAncora: 90 },
    ],
  },
  {
    nome: "28/42/56 dias da emissão da nota",
    ancora: "EMISSAO_NOTA",
    parcelas: [
      { ordem: 1, percentual: 33.34, diasAposAncora: 28 },
      { ordem: 2, percentual: 33.33, diasAposAncora: 42 },
      { ordem: 3, percentual: 33.33, diasAposAncora: 56 },
    ],
  },
];

// Idempotente: só cria se a gráfica ainda não tem NENHUMA CondicaoPagamento
// cadastrada — mesmo princípio de garantirCategoriasCustoPadrao em
// src/lib/custo-pedido.ts. Se a gráfica já tinha condições e apagou todas de
// propósito (soft-delete via `ativa`, nunca hard-delete de verdade), isto
// NUNCA recria sozinho. Chamado sob demanda pela tela de configuração
// (lazy-bootstrap), nunca no fluxo de criação de conta/gráfica.
export async function garantirCondicoesPagamentoPadrao(graficaId: string): Promise<void> {
  const existentes = await prisma.condicaoPagamento.count({ where: { graficaId } });
  if (existentes > 0) return;

  for (const sugestao of CONDICOES_PAGAMENTO_SUGERIDAS) {
    await prisma.condicaoPagamento.create({
      data: {
        graficaId,
        nome: sugestao.nome,
        ancora: sugestao.ancora,
        acrescimoPercent: sugestao.acrescimoPercent ?? null,
        parcelas: {
          create: sugestao.parcelas.map((parcela) => ({
            ordem: parcela.ordem,
            percentual: parcela.percentual,
            diasAposAncora: parcela.diasAposAncora,
          })),
        },
      },
    });
  }
}

function arredondarCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// Gera as ContaReceber de um orçamento recém-aprovado, a partir da
// CondicaoPagamento vinculada (Orcamento.condicaoPagamentoId) — SNAPSHOT no
// momento da aprovação, nunca recalculado depois: mudar a condição (ou suas
// parcelas) mais tarde, ou até desativá-la, não altera nada do que já foi
// gravado aqui (mesma disciplina de Comissao). Chamada DENTRO da mesma
// transação que aprova o orçamento (ver atualizarStatusOrcamento em
// src/app/orcamento/[id]/actions.ts e responderOrcamentoPublico em
// src/app/o/[token]/actions.ts) — se algo aqui falhar, desfaz junto com o
// resto da aprovação (Pedido, Comissao etc.).
//
// Escopo desta rodada (achado A7 da Parte 4, 2026-08-28): só gera algo
// quando a condição vinculada tem ancora=APROVACAO — é a única âncora com
// gatilho automático plumbado até agora, por acontecer dentro desta própria
// transação, sem depender de outro evento do sistema. EMISSAO_NOTA e
// ENTREGA ficam com o enum pronto e o vínculo gravável (a condição pode ser
// cadastrada e escolhida no orçamento normalmente), mas SEM gatilho — até uma
// rodada futura plumbar isso em emitirNfe (src/lib/focus-nfe.ts) e em
// avancarPedido (src/app/producao/actions.ts, transição pra ENTREGUE), o
// comportamento pra essas duas âncoras é idêntico a não ter condição nenhuma
// vinculada: a gráfica cadastra a parcela à mão, como sempre (ver
// criarContaReceber em src/app/financeiro/contas-receber/actions.ts).
export async function gerarContasReceberDaAprovacao(
  tx: Prisma.TransactionClient,
  params: {
    graficaId: string;
    orcamentoId: string;
    condicaoPagamentoId: string | null;
    total: number;
    aprovadoEm: Date;
  }
): Promise<void> {
  if (!params.condicaoPagamentoId || params.total <= 0) return;

  const condicao = await tx.condicaoPagamento.findFirst({
    where: { id: params.condicaoPagamentoId, graficaId: params.graficaId },
    include: { parcelas: { orderBy: { ordem: "asc" } } },
  });
  // Condição não encontrada (nunca deveria acontecer — é FK, e não existe
  // hard-delete de CondicaoPagamento) ou sem nenhuma parcela cadastrada: a
  // aprovação segue sem gerar conta nenhuma em vez de travar o pedido
  // inteiro por causa de dado de configuração incompleto.
  if (!condicao || condicao.parcelas.length === 0) return;
  // Gap remanescente documentado acima — só APROVACAO dispara automático.
  if (condicao.ancora !== "APROVACAO") return;

  const acrescimo = condicao.acrescimoPercent ? Number(condicao.acrescimoPercent) : 0;
  const totalComAcrescimo = params.total * (1 + acrescimo / 100);

  // Dia-calendário de Brasília em que a aprovação aconteceu, como data-pura
  // UTC (mesmo padrão de Despesa.vencimento/ContaReceber.vencimento) — a
  // partir daí é só somar dias corridos, sem se preocupar com DST (Brasília
  // não tem desde 2019).
  const diaBaseUTC = dataInputParaUTC(hojeBrasiliaInputValue(params.aprovadoEm));

  const totalParcelas = condicao.parcelas.length;
  let somaAcumulada = 0;
  for (let indice = 0; indice < totalParcelas; indice++) {
    const parcela = condicao.parcelas[indice];
    const ehUltima = indice === totalParcelas - 1;
    // Última parcela absorve o resto do arredondamento — nunca deixa a soma
    // das parcelas divergir do total por causa de centavos perdidos em
    // percentuais como 33.33/33.33/33.34.
    const valor = ehUltima
      ? arredondarCentavos(totalComAcrescimo - somaAcumulada)
      : arredondarCentavos((totalComAcrescimo * Number(parcela.percentual)) / 100);
    somaAcumulada += valor;

    const vencimento = new Date(diaBaseUTC.getTime() + parcela.diasAposAncora * 86_400_000);

    await tx.contaReceber.create({
      data: {
        graficaId: params.graficaId,
        orcamentoId: params.orcamentoId,
        descricao: `Parcela ${parcela.ordem}/${totalParcelas} — ${condicao.nome}`,
        valor,
        vencimento,
      },
    });
  }
}
