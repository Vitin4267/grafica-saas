// Achado A11 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
// desempenho de fornecedor além de preço: OTIF (On Time In Full), o KPI
// padrão de gestão de fornecedores. Nenhuma tabela nova — deriva tudo de
// SolicitacaoCompra (+ CotacaoFornecedor vencedora) já existente, mesma
// filosofia de comparativo-fornecedores.ts (histórico RETROSPECTIVO,
// derivado de compras já fechadas). Lógica pura, sem Prisma, pra poder
// testar sem banco — a leitura do banco fica em
// desempenho-fornecedor-db.ts (mesma separação de comparativo-fornecedores/
// -db.ts e previsao-estoque/-db.ts).
//
// Depende de 3 achados já construídos (é por isso que este é 🟢 Barato):
// - A4 (CotacaoFornecedor.prazoEntregaDias) — prazo PROMETIDO na cotação
//   vencedora vinculada a cada solicitação.
// - A7 (recebimento parcial, 2026-09-07) — divergenciaObservacao marca
//   quando a quantidade recebida numa confirmação diverge do esperado;
//   recebidoEm é sobrescrito em TODA confirmação (parcial ou final) e por
//   isso já funciona como "data do ÚLTIMO recebimento" sem mudança nenhuma
//   aqui (ver comentário de CAMPO_DATA_POR_STATUS em status-transicao.ts).
// - A8 (lead time) — compradoEm/recebidoEm existem pra calcular prazo real.

// Tamanho mínimo de amostra pra exibir um percentual com confiança — com 1
// ou 2 compras, "100%" ou "0%" é enganoso (uma entrega atrasada de 1 vira
// "0% no prazo" pro fornecedor, uma sorte de 1 vira "100%"). 3 é o menor
// número que já permite 1 exceção sem virar 0% ou 100% automaticamente, e é
// o mesmo patamar usado informalmente por scorecards de fornecedor no
// mercado (ex: "últimas 3+ entregas"). Decisão registrada aqui de propósito
// — reavaliar se o cliente-piloto achar 3 baixo/alto na prática.
export const AMOSTRA_MINIMA_DESEMPENHO = 3;

// Uma SolicitacaoCompra já fechada (status RECEBIDO ou CONFERIDO — ver
// desempenho-fornecedor-db.ts pro filtro; RECEBIDO_PARCIAL fica de fora
// porque ainda está em aberto, não é um caso pra julgar ainda) reduzida ao
// que este cálculo precisa.
export type CompraParaDesempenho = {
  fornecedorId: string;
  fornecedorNome: string;
  // Referência do prazo prometido: a contagem de dias da cotação vencedora
  // ("entrega em X dias") começa da CONFIRMAÇÃO da compra com o fornecedor
  // (transição APROVADO/COTANDO→COMPRADO), não da data da cotação em si —
  // é quando o fornecedor de fato assume o compromisso de entrega. Sempre
  // preenchido pra qualquer solicitação que chegou em RECEBIDO/CONFERIDO
  // (COMPRADO é obrigatório antes disso na FSM, ver TRANSICOES_VALIDAS em
  // compras-status.ts) — o tipo permite null só defensivamente.
  compradoEm: Date | null;
  // Data do ÚLTIMO recebimento confirmado (parcial ou final) — ver
  // comentário do módulo acima sobre CAMPO_DATA_POR_STATUS. É contra essa
  // data (não a de uma eventual primeira parcial) que "no prazo" compara,
  // porque OTIF por definição é "completo E no prazo" — só faz sentido
  // julgar pontualidade do pedido INTEIRO quando ele de fato fechou.
  recebidoEm: Date | null;
  // Achado A4 — CotacaoFornecedor.prazoEntregaDias da cotação VENCEDORA
  // vinculada a esta solicitação. null quando não há cotação vencedora
  // vinculada (compra direta sem cotação formal, ou cotação vencedora sem
  // prazo preenchido — campo opcional lá também) — ver decisão de
  // elegibilidade abaixo.
  prazoEntregaDiasPrometido: number | null;
  // Achado A7 — preenchido quando alguma confirmação de recebimento desta
  // solicitação divergiu do restante esperado. Presença (não o texto em si)
  // é o que importa aqui: "completo" = null/vazio.
  divergenciaObservacao: string | null;
};

// Uma métrica agregada (percentual de sucesso sobre uma amostra) — `amostra`
// é o denominador REAL usado (pode ser menor que o total de compras do
// fornecedor, ver decisão de elegibilidade de "no prazo"/"otif" abaixo).
// `percentual` fica `null` quando `amostra === 0` (nenhuma compra elegível
// pra esta métrica — não confundir com "amostra pequena", ver
// AMOSTRA_MINIMA_DESEMPENHO: quem consome decide o corte de confiança, esta
// função só devolve o dado bruto).
export type MetricaDesempenho = {
  amostra: number;
  percentual: number | null;
};

export type DesempenhoFornecedor = {
  fornecedorId: string;
  fornecedorNome: string;
  // Total de solicitações fechadas (RECEBIDO/CONFERIDO) deste fornecedor —
  // é o denominador de `completo` (toda compra fechada tem uma resposta
  // sim/não pra "chegou completa", com ou sem cotação por trás).
  totalCompras: number;
  // % de compras cuja confirmação final aconteceu até compradoEm + prazo
  // prometido. Decisão de elegibilidade (ver comentário do módulo/
  // prazoEntregaDiasPrometido): compra SEM cotação vencedora vinculada (ou
  // vencedora sem prazo preenchido) não entra no numerador NEM no
  // denominador — não há promessa nenhuma pra confrontar, então "no prazo"
  // simplesmente não se aplica a essa linha (diferente de contá-la como
  // atraso, que puniria injustamente compra direta sem cotação formal).
  noPrazo: MetricaDesempenho;
  // % de compras que fecharam sem divergenciaObservacao preenchida — TODA
  // compra fechada é elegível (não depende de cotação/prazo), então
  // `completo.amostra === totalCompras` sempre.
  completo: MetricaDesempenho;
  // % de compras "no prazo" E "completa" ao mesmo tempo — mesma
  // elegibilidade de `noPrazo` (precisa de promessa de prazo pra fazer
  // sentido comparar "no prazo"; sem isso OTIF não pode ser calculado pra
  // essa linha, mesmo que "completo" sozinho pudesse).
  otif: MetricaDesempenho;
  // Contagem simples (não percentual) de compras com divergência registrada
  // — inclui toda compra fechada, com ou sem cotação/prazo por trás.
  comDivergencia: number;
};

function metrica(numerador: number, amostra: number): MetricaDesempenho {
  return { amostra, percentual: amostra > 0 ? (numerador / amostra) * 100 : null };
}

// Agrupa compras já fechadas por fornecedor e calcula as 4 métricas do
// achado A11. Puramente derivado — nenhuma leitura de banco aqui (ver
// desempenho-fornecedor-db.ts).
export function calcularDesempenhoFornecedores(
  compras: CompraParaDesempenho[]
): Map<string, DesempenhoFornecedor> {
  const porFornecedor = new Map<string, CompraParaDesempenho[]>();
  for (const compra of compras) {
    const lista = porFornecedor.get(compra.fornecedorId);
    if (lista) {
      lista.push(compra);
    } else {
      porFornecedor.set(compra.fornecedorId, [compra]);
    }
  }

  const resultado = new Map<string, DesempenhoFornecedor>();
  for (const [fornecedorId, lista] of porFornecedor) {
    const fornecedorNome = lista[0].fornecedorNome;
    const totalCompras = lista.length;

    let completasCount = 0;
    let comDivergencia = 0;
    let noPrazoElegiveis = 0;
    let noPrazoCount = 0;
    let otifCount = 0;

    for (const compra of lista) {
      const completa = !compra.divergenciaObservacao;
      if (completa) {
        completasCount++;
      } else {
        comDivergencia++;
      }

      // Elegibilidade de "no prazo"/"otif" — ver comentário de
      // prazoEntregaDiasPrometido no tipo CompraParaDesempenho acima.
      const temPromessaDePrazo =
        compra.prazoEntregaDiasPrometido !== null && compra.compradoEm !== null && compra.recebidoEm !== null;
      if (!temPromessaDePrazo) continue;

      const prazoLimite = new Date(compra.compradoEm!);
      prazoLimite.setDate(prazoLimite.getDate() + compra.prazoEntregaDiasPrometido!);
      const noPrazo = compra.recebidoEm!.getTime() <= prazoLimite.getTime();

      noPrazoElegiveis++;
      if (noPrazo) noPrazoCount++;
      if (noPrazo && completa) otifCount++;
    }

    resultado.set(fornecedorId, {
      fornecedorId,
      fornecedorNome,
      totalCompras,
      noPrazo: metrica(noPrazoCount, noPrazoElegiveis),
      completo: metrica(completasCount, totalCompras),
      // Mesmo denominador de noPrazo — ver comentário de `otif` no tipo
      // DesempenhoFornecedor acima.
      otif: metrica(otifCount, noPrazoElegiveis),
      comDivergencia,
    });
  }

  return resultado;
}
