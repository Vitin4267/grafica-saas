// Cálculo puro (sem Prisma) — testável isoladamente. A consulta ao banco
// fica em previsao-estoque-db.ts, que chama isto pra cada matéria-prima.

// Olha as saídas dos últimos 60 dias pra calcular a taxa de consumo — janela
// grande o suficiente pra suavizar picos de um pedido grande isolado, mas não
// tão grande que dado de meses atrás (produto descontinuado, por exemplo)
// distorça a previsão de hoje.
export const JANELA_DIAS = 60;

// Menos que isso não é uma taxa, é ruído — mostra "sem dados suficientes" em
// vez de arriscar uma previsão de uma saída só.
export const MINIMO_MOVIMENTACOES = 2;

// Um item só entra no alerta de "acabando" se a previsão apontar menos que
// isso, mesmo que ainda esteja acima do estoque mínimo cadastrado — é
// literalmente o ponto desta feature: avisar ANTES de bater o mínimo.
export const LIMITE_DIAS_ALERTA = 30;

export type PrevisaoCalculada = {
  consumoMedioDiario: number | null;
  diasRestantes: number | null;
  dataPrevistaEsgotamento: Date | null;
};

// `movimentacoes` já deve vir filtrada só pelas saídas dentro da janela.
export function calcularPrevisaoItem(
  estoqueAtual: number,
  movimentacoes: { quantidade: number; createdAt: Date }[],
  agora: Date
): PrevisaoCalculada {
  if (movimentacoes.length < MINIMO_MOVIMENTACOES) {
    return { consumoMedioDiario: null, diasRestantes: null, dataPrevistaEsgotamento: null };
  }

  const totalConsumido = movimentacoes.reduce((soma, m) => soma + m.quantidade, 0);
  const primeiraMovimentacao = movimentacoes.reduce(
    (maisAntiga, m) => (m.createdAt < maisAntiga ? m.createdAt : maisAntiga),
    movimentacoes[0].createdAt
  );
  const diasComDados = Math.max(1, (agora.getTime() - primeiraMovimentacao.getTime()) / (1000 * 60 * 60 * 24));
  const consumoMedioDiario = totalConsumido / diasComDados;

  if (consumoMedioDiario <= 0) {
    return { consumoMedioDiario: null, diasRestantes: null, dataPrevistaEsgotamento: null };
  }

  const diasRestantes = estoqueAtual / consumoMedioDiario;
  const dataPrevistaEsgotamento = new Date(agora.getTime() + diasRestantes * 24 * 60 * 60 * 1000);

  return { consumoMedioDiario, diasRestantes, dataPrevistaEsgotamento };
}

export type PrevisaoMateriaPrima = PrevisaoCalculada & {
  id: string;
  nome: string;
  categoria: string;
  unidade: string;
  estoqueAtual: number;
  estoqueMinimo: number | null;
  abaixoDoMinimo: boolean;
};

// Previsão disponível vem primeiro, ordenada por urgência; abaixo do mínimo
// sem previsão confiável vem em seguida; o resto por último.
export function ordenarPorUrgencia(itens: PrevisaoMateriaPrima[]): PrevisaoMateriaPrima[] {
  return [...itens].sort((a, b) => {
    if (a.diasRestantes !== null && b.diasRestantes !== null) return a.diasRestantes - b.diasRestantes;
    if (a.diasRestantes !== null) return -1;
    if (b.diasRestantes !== null) return 1;
    if (a.abaixoDoMinimo !== b.abaixoDoMinimo) return a.abaixoDoMinimo ? -1 : 1;
    return 0;
  });
}
