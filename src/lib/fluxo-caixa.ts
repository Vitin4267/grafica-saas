/**
 * Projeção de fluxo de caixa — função PURA (sem efeitos colaterais ou I/O).
 *
 * Recebe um saldo inicial e listas de contas a receber/despesas PENDENTES
 * (com vencimento e valor), e retorna buckets de projeção semanal (primeiros 30 dias)
 * e mensal (até 90 dias), cada um com entradas, saídas e saldo acumulado.
 *
 * Limitação conhecida: saldo inicial sempre começa em 0. Um conceito de "saldo
 * inicial configurável" é previsto pra uma rodada futura.
 */

/** Uma transação financeira (entrada/saída) com vencimento */
export interface Transacao {
  vencimento: Date;
  valor: number;
}

/**
 * Resultado de um bucket de projeção — semana ou mês.
 * - rotulo: descrição amigável do período (ex: "Semana 1", "Setembro")
 * - entradas: soma de contas a receber neste período
 * - saidas: soma de despesas neste período
 * - saldoAcumulado: saldo até o final deste período
 */
export interface BucketProjecao {
  rotulo: string;
  entradas: number;
  saidas: number;
  saldoAcumulado: number;
}

/**
 * Resultado completo da projeção de fluxo de caixa.
 * - buckets: array de períodos (semanais + mensais)
 * - dataFicaNegativo: primeira data em que o saldo acumulado fica negativo, ou null se nunca
 * - diasAteNegativo: número de dias até ficar negativo, ou null se nunca
 */
export interface ProjecaoFluxoCaixa {
  buckets: BucketProjecao[];
  dataFicaNegativo: Date | null;
  diasAteNegativo: number | null;
}

/**
 * Calcula a projeção de fluxo de caixa para os próximos 90 dias.
 *
 * @param saldoInicial Saldo em caixa no dia 0 (inclusive)
 * @param contasReceber Lista de contas a receber pendentes (com vencimento, valor > 0)
 * @param despesas Lista de despesas pendentes (com vencimento, valor > 0)
 * @returns Buckets de projeção semanal (30 dias) e mensal (60-90 dias), mais alerta de negatividade
 *
 * Lógica:
 * - Primeiro 30 dias: buckets de 7 dias (semanas)
 * - Próximos 60 dias: buckets de 30 dias (meses)
 * - Transações são registradas no dia do vencimento (não antes, não depois)
 * - Saldo acumulado é calculado cumulativamente — cada bucket parte do saldo anterior
 * - dataFicaNegativo: primeiro dia em que qualquer saldo parcial fica negativo
 *   (usa busca dia-a-dia quando saldoAcumulado muda, não interpola linearmente)
 */
export function calcularProjecaoFluxoCaixa(
  saldoInicial: number,
  contasReceber: Transacao[],
  despesas: Transacao[]
): ProjecaoFluxoCaixa {
  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);

  // Agregação por dia: cada dia tem entradas e saídas totalizadas.
  // Transação já vencida (vencimento <= hoje) é clampada pro dia +1 (início
  // da Semana 1) em vez de simplesmente cair fora da janela [+1, +90] e
  // sumir da projeção — pra um recurso cujo propósito é avisar "você fica
  // negativo", omitir dívida já vencida seria o pior tipo de bug: esconderia
  // justo o cenário mais urgente (gráfica já com contas vencidas).
  const transacoesPorDia = new Map<string, { entradas: number; saidas: number }>();

  function diaClampeadoParaHoje(vencimento: Date): string {
    const dataEfetiva = vencimento.getTime() <= hoje.getTime() ? diaMaisUm(hoje) : vencimento;
    return formatarDataComoCodigo(dataEfetiva);
  }

  for (const cr of contasReceber) {
    const dia = diaClampeadoParaHoje(cr.vencimento);
    const atual = transacoesPorDia.get(dia) || { entradas: 0, saidas: 0 };
    atual.entradas += cr.valor;
    transacoesPorDia.set(dia, atual);
  }

  for (const d of despesas) {
    const dia = diaClampeadoParaHoje(d.vencimento);
    const atual = transacoesPorDia.get(dia) || { entradas: 0, saidas: 0 };
    atual.saidas += d.valor;
    transacoesPorDia.set(dia, atual);
  }

  // Buckets: semana 1-4 (dias +1 até +28), depois mês 2-3 (dias +29 até +90)
  // Convenção: dia N significa "N dias a partir de hoje" (hoje+1 = amanhã)
  const buckets: BucketProjecao[] = [];
  let saldoAcumulado = saldoInicial;
  let dataFicaNegativo: Date | null = null;
  let diasAteNegativo: number | null = null;

  // Semanas 1-4: dias +1 a +28
  for (let semana = 1; semana <= 4; semana++) {
    const offsetInicio = (semana - 1) * 7 + 1; // 1, 8, 15, 22
    const offsetFim = semana * 7; // 7, 14, 21, 28
    let entradas = 0;
    let saidas = 0;

    for (let offset = offsetInicio; offset <= offsetFim; offset++) {
      const dataConsiderada = new Date(hoje);
      dataConsiderada.setUTCDate(dataConsiderada.getUTCDate() + offset);
      const codigo = formatarDataComoCodigo(dataConsiderada);

      const transacao = transacoesPorDia.get(codigo);
      if (transacao) {
        entradas += transacao.entradas;
        saidas += transacao.saidas;

        // Monitora negatividade no fim de cada dia que tem mudança
        const saldoNesteDia = saldoAcumulado + entradas - saidas;
        if (dataFicaNegativo === null && saldoNesteDia < 0) {
          dataFicaNegativo = new Date(dataConsiderada);
          diasAteNegativo = offset; // Offset direto = dias até a negatividade
        }
      }
    }

    saldoAcumulado += entradas - saidas;
    buckets.push({
      rotulo: `Semana ${semana}`,
      entradas,
      saidas,
      saldoAcumulado,
    });
  }

  // Mês 2 (dias +29 a +58)
  {
    let entradas = 0;
    let saidas = 0;

    for (let offset = 29; offset <= 58; offset++) {
      const dataConsiderada = new Date(hoje);
      dataConsiderada.setUTCDate(dataConsiderada.getUTCDate() + offset);
      const codigo = formatarDataComoCodigo(dataConsiderada);

      const transacao = transacoesPorDia.get(codigo);
      if (transacao) {
        entradas += transacao.entradas;
        saidas += transacao.saidas;

        if (dataFicaNegativo === null && saldoAcumulado + entradas - saidas < 0) {
          dataFicaNegativo = new Date(dataConsiderada);
          diasAteNegativo = offset;
        }
      }
    }

    saldoAcumulado += entradas - saidas;
    buckets.push({
      rotulo: "Mês 2",
      entradas,
      saidas,
      saldoAcumulado,
    });
  }

  // Mês 3 (dias +59 a +90)
  {
    let entradas = 0;
    let saidas = 0;

    for (let offset = 59; offset <= 90; offset++) {
      const dataConsiderada = new Date(hoje);
      dataConsiderada.setUTCDate(dataConsiderada.getUTCDate() + offset);
      const codigo = formatarDataComoCodigo(dataConsiderada);

      const transacao = transacoesPorDia.get(codigo);
      if (transacao) {
        entradas += transacao.entradas;
        saidas += transacao.saidas;

        if (dataFicaNegativo === null && saldoAcumulado + entradas - saidas < 0) {
          dataFicaNegativo = new Date(dataConsiderada);
          diasAteNegativo = offset;
        }
      }
    }

    saldoAcumulado += entradas - saidas;
    buckets.push({
      rotulo: "Mês 3",
      entradas,
      saidas,
      saldoAcumulado,
    });
  }

  return { buckets, dataFicaNegativo, diasAteNegativo };
}

/** Dia seguinte a `d`, em UTC — usado só pra clampar vencimento já passado. */
function diaMaisUm(d: Date): Date {
  const proximo = new Date(d);
  proximo.setUTCDate(proximo.getUTCDate() + 1);
  return proximo;
}

/** Formata uma Date como "YYYY-MM-DD" em UTC para uso como chave */
function formatarDataComoCodigo(d: Date): string {
  const ano = d.getUTCFullYear();
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}
