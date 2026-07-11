// Formatador único pra campo de data-pura (sem hora), tipo Despesa.vencimento.
// `timeZone: "UTC"` é obrigatório aqui: essas datas são guardadas como meia-
// noite UTC (ver comentário em Despesa.vencimento no schema), então formatar
// sem fixar o fuso pode mostrar o dia errado dependendo de onde o código
// roda (servidor) ou de onde a pessoa está (navegador).
export const formatoData = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

// Converte o valor de um <input type="date"> ("2026-07-15") pra Date em
// meia-noite UTC — nunca usar `new Date(valor)` puro pra isso (o
// comportamento varia por engine/timezone do processo).
export function dataInputParaUTC(valor: string): Date {
  return new Date(`${valor}T00:00:00Z`);
}

// Caminho inverso: de volta pro formato "AAAA-MM-DD" que um <input
// type="date"> espera como defaultValue, sempre lendo os componentes em UTC.
export function dataParaInputValue(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function dataEhPassado(data: Date): boolean {
  const hojeUTC = new Date();
  hojeUTC.setUTCHours(0, 0, 0, 0);
  return data.getTime() < hojeUTC.getTime();
}
