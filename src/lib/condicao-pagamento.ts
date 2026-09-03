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

type ParamsGeracaoContaReceber = {
  graficaId: string;
  orcamentoId: string;
  // Achado A10 da Parte 5 — preenche ContaReceber.clienteId no nascimento
  // (ver comentário no schema.prisma), evitando o join
  // ContaReceber → Orcamento → clienteId em toda consulta financeira "por
  // cliente".
  clienteId: string;
  condicaoPagamentoId: string | null;
  total: number;
  // Dia em que o evento-gatilho (aprovação, emissão de nota ou entrega)
  // aconteceu — base do cálculo de vencimento de cada parcela
  // (diaBase + parcela.diasAposAncora).
  dataAncora: Date;
};

// Núcleo compartilhado dos 3 gatilhos automáticos de ContaReceber (achado R1
// da auditoria de abrangência, Parte 7, 2026-09-03) — gera as parcelas da
// CondicaoPagamento vinculada ao orçamento (Orcamento.condicaoPagamentoId)
// QUANDO o evento que chamou bate com a âncora configurada na condição
// (`ancoraGatilho`). SNAPSHOT no momento do evento, nunca recalculado depois:
// mudar a condição (ou suas parcelas) mais tarde, ou até desativá-la, não
// altera nada do que já foi gravado aqui (mesma disciplina de Comissao).
// Chamada DENTRO da mesma transação que muda o estado que dispara o evento
// (aprovação do orçamento, emissão de NF-e, entrada do pedido em ENTREGUE) —
// se algo aqui falhar, desfaz junto com o resto.
//
// Idempotência: cada um dos 3 gatilhos pode, na prática, rodar mais de uma
// vez pro MESMO orçamento (reconsulta de status de NF-e depois de já
// autorizada, por exemplo) — diferente da aprovação, que é protegida por um
// CAS em Orcamento.status que só permite a transição uma vez. Sem uma coluna
// dedicada marcando "geração automática já rodou" (evitado de propósito —
// não precisa de schema novo pra resolver isto), o marcador usado é a
// PRÓPRIA ContaReceber já criada: se já existe alguma conta deste orçamento
// cuja descrição termina em "— {nome da condição}" (o sufixo que este mesmo
// bloco sempre grava, ver `contaReceber.create` abaixo), a geração já
// aconteceu e a chamada é um no-op. Efeito colateral aceito: uma
// ContaReceber MANUAL cadastrada à mão com essa mesma condição no texto
// (raro — a gráfica normalmente descreve manualmente sem citar o nome exato
// da condição) bloquearia a geração automática; dado o baixo risco e a
// alternativa (migration só pra isso), essa é a troca deliberada.
async function gerarContasReceberPorAncora(
  tx: Prisma.TransactionClient,
  ancoraGatilho: AncoraVencimento,
  params: ParamsGeracaoContaReceber
): Promise<void> {
  if (!params.condicaoPagamentoId || params.total <= 0) return;

  const condicao = await tx.condicaoPagamento.findFirst({
    where: { id: params.condicaoPagamentoId, graficaId: params.graficaId },
    include: { parcelas: { orderBy: { ordem: "asc" } } },
  });
  // Condição não encontrada (nunca deveria acontecer — é FK, e não existe
  // hard-delete de CondicaoPagamento) ou sem nenhuma parcela cadastrada: o
  // evento segue sem gerar conta nenhuma em vez de travar o resto do fluxo
  // por causa de dado de configuração incompleto.
  if (!condicao || condicao.parcelas.length === 0) return;
  // A condição vinculada usa outra âncora (ex: orçamento tem condição
  // EMISSAO_NOTA, mas quem chamou foi o gatilho de ENTREGA) — nada a fazer
  // aqui, o gatilho certo cuida disso quando o evento certo acontecer.
  if (condicao.ancora !== ancoraGatilho) return;

  const marcadorGeracao = `— ${condicao.nome}`;
  const jaGerado = await tx.contaReceber.findFirst({
    where: { orcamentoId: params.orcamentoId, descricao: { endsWith: marcadorGeracao } },
    select: { id: true },
  });
  if (jaGerado) return;

  const acrescimo = condicao.acrescimoPercent ? Number(condicao.acrescimoPercent) : 0;
  const totalComAcrescimo = params.total * (1 + acrescimo / 100);

  // Dia-calendário de Brasília em que o evento aconteceu, como data-pura UTC
  // (mesmo padrão de Despesa.vencimento/ContaReceber.vencimento) — a partir
  // daí é só somar dias corridos, sem se preocupar com DST (Brasília não tem
  // desde 2019).
  const diaBaseUTC = dataInputParaUTC(hojeBrasiliaInputValue(params.dataAncora));

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
        clienteId: params.clienteId,
        descricao: `Parcela ${parcela.ordem}/${totalParcelas} ${marcadorGeracao}`,
        valor,
        vencimento,
      },
    });
  }
}

// Gatilho 1/3 — aprovação do orçamento. Chamada DENTRO da mesma transação
// que aprova o orçamento (ver atualizarStatusOrcamento em
// src/app/orcamento/[id]/actions.ts e responderOrcamentoPublico em
// src/app/o/[token]/actions.ts). Idempotência garantida ali por um CAS em
// Orcamento.status (updateMany com where status=status-anterior) — a
// transição só passa uma vez, então esta função nunca roda duas vezes pro
// mesmo orçamento por este caminho (o marcador em
// gerarContasReceberPorAncora é redundância defensiva, não a proteção
// principal aqui).
export async function gerarContasReceberDaAprovacao(
  tx: Prisma.TransactionClient,
  params: {
    graficaId: string;
    orcamentoId: string;
    clienteId: string;
    condicaoPagamentoId: string | null;
    total: number;
    aprovadoEm: Date;
  }
): Promise<void> {
  return gerarContasReceberPorAncora(tx, "APROVACAO", { ...params, dataAncora: params.aprovadoEm });
}

// Gatilho 2/3 — emissão de NF-e autorizada. Chamada DENTRO da mesma
// transação que grava NotaFiscal.status="AUTORIZADA" (ver emitirNotaFiscal e
// atualizarStatusNotaFiscal em src/app/orcamento/[id]/actions.ts) — os dois
// pontos em que uma nota pode virar AUTORIZADA (emissão síncrona e consulta
// de status depois de PROCESSANDO). Diferente da aprovação, não há CAS
// natural aqui (o mesmo card pode ter seu status reconsultado várias vezes
// depois de já autorizado), então a idempotência real vem do marcador em
// gerarContasReceberPorAncora.
export async function gerarContasReceberDaEmissaoNota(
  tx: Prisma.TransactionClient,
  params: {
    graficaId: string;
    orcamentoId: string;
    clienteId: string;
    condicaoPagamentoId: string | null;
    total: number;
    emitidoEm: Date;
  }
): Promise<void> {
  return gerarContasReceberPorAncora(tx, "EMISSAO_NOTA", { ...params, dataAncora: params.emitidoEm });
}

// Gatilho 3/3 — pedido chega em ENTREGUE. Chamada DENTRO da mesma transação
// que avança Pedido.status pra ENTREGUE (ver avancarStatusPedido em
// src/app/producao/status-transicao.ts). Idempotência: ENTREGUE é o último
// estágio de SEQUENCIA_STATUS_PEDIDO (não há transição pra fora dele) e a
// própria transição é protegida por CAS (updateMany com where
// status=status-anterior) — na prática só corre uma vez por pedido, mas o
// marcador em gerarContasReceberPorAncora cobre mesmo assim qualquer
// reentrada (ex: reprocessamento manual do mesmo evento).
export async function gerarContasReceberDaEntrega(
  tx: Prisma.TransactionClient,
  params: {
    graficaId: string;
    orcamentoId: string;
    clienteId: string;
    condicaoPagamentoId: string | null;
    total: number;
    entregueEm: Date;
  }
): Promise<void> {
  return gerarContasReceberPorAncora(tx, "ENTREGA", { ...params, dataAncora: params.entregueEm });
}
