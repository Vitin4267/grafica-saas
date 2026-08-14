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

// Converte o valor de um <input type="datetime-local"> ("2026-07-15T14:30")
// pra Date — mesma filosofia de dataInputParaUTC: trata o horário digitado
// como literal (nunca reinterpreta por fuso de servidor/navegador), só que
// pra data+hora em vez de só data. Usado pelas etapas de produção do
// orçamento (Orcamento.etapa*Em), que guardam "às 14:30 conforme digitado",
// não um instante ajustado por timezone.
export function dataHoraInputParaUTC(valor: string): Date {
  return new Date(`${valor}:00Z`);
}

// Caminho inverso: de volta pro formato "AAAA-MM-DDTHH:mm" que um <input
// type="datetime-local"> espera como defaultValue, sempre lendo os
// componentes em UTC (mesmo raciocínio de dataParaInputValue).
export function dataHoraParaInputValue(data: Date): string {
  return data.toISOString().slice(0, 16);
}

export function dataEhPassado(data: Date): boolean {
  const hojeUTC = new Date();
  hojeUTC.setUTCHours(0, 0, 0, 0);
  return data.getTime() < hojeUTC.getTime();
}

// ---------------------------------------------------------------------------
// INSTANTE REAL (createdAt, pagoEm, emitidaEm, dataPrevistaEsgotamento — o
// momento em que algo de fato aconteceu ou vai acontecer), em contraste com
// tudo acima, que é pra DATA-PURA (Despesa.vencimento e similares: meia-noite
// UTC representando um dia de calendário que alguém digitou).
//
// Por que a distinção importa: o runtime da Vercel roda em UTC; a máquina de
// dev roda em horário de Brasília (UTC−3 fixo, sem horário de verão desde
// 2019). `new Date().getFullYear()/getMonth()` e `toLocaleString`/
// `toLocaleDateString` sem `timeZone` seguem o fuso do PROCESSO — então o
// mesmo instante real (ex: um orçamento aprovado às 22h de Brasília do
// último dia do mês) aparece/filtra diferente dependendo de onde o código
// roda. Pra data-pura isso não é problema (ela já é UTC de propósito, ver
// formatoData acima); pra instante real, PRECISA fixar "America/Sao_Paulo"
// explicitamente na exibição e usar fronteira de mês com offset de Brasília
// no filtro.
//
// Regra prática pro próximo dev: campo veio de um <input type="date"> ou
// <input type="datetime-local"> (ex: Despesa.vencimento, Orcamento.etapa*Em)
// → é literal, use formatoData/dataInputParaUTC/dataHoraInputParaUTC. Campo
// é `@default(now())` ou marca "quando algo aconteceu de fato" (createdAt,
// pagoEm, emitidaEm) → é instante real, use os formatadores/helpers abaixo.
// Na dúvida, confira o comentário do campo em prisma/schema.prisma.

// Brasília é UTC−3 fixo (sem horário de verão desde 2019) — então "meia-
// noite de dia 1 em Brasília" é sempre 03:00 UTC do mesmo dia.
const OFFSET_BRASILIA_HORAS = 3;

// Ano e mês (1-based) do calendário de BRASÍLIA em que `instante` cai. Nunca
// usar `instante.getFullYear()/getMonth()` pra isso num código que roda no
// servidor — esses métodos leem o fuso do processo (Brasília no dev, UTC na
// Vercel), então o mesmo instante pode "virar o mês" 3h mais cedo do que
// deveria dependendo de onde roda.
export function anoMesBrasilia(instante: Date): { ano: number; mes: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
  }).formatToParts(instante);
  return {
    ano: Number(partes.find((p) => p.type === "year")!.value),
    mes: Number(partes.find((p) => p.type === "month")!.value),
  };
}

// Fronteira de mês (início do mês e início do mês seguinte), a partir de
// ano/mês (1-based) já conhecidos — pra filtrar colunas de INSTANTE REAL
// (createdAt, pagoEm, emitidaEm) por "mês tal", nunca por data-pura (essa
// continua com a fronteira em UTC puro, sem o offset de Brasília — ver
// formatoData). Os dois limites vêm como instante UTC prontos pra usar num
// `gte`/`lt` do Prisma.
export function limitesMesBrasilia(ano: number, mesUmBaseado: number): { inicio: Date; fim: Date } {
  return {
    inicio: new Date(Date.UTC(ano, mesUmBaseado - 1, 1, OFFSET_BRASILIA_HORAS, 0, 0, 0)),
    fim: new Date(Date.UTC(ano, mesUmBaseado, 1, OFFSET_BRASILIA_HORAS, 0, 0, 0)),
  };
}

// Início do mês CORRENTE (contendo `agora`) no calendário de Brasília, já
// como instante UTC — atalho pra `limitesMesBrasilia` quando quem chama só
// tem "agora" (não um ano/mês já parseado de input) e só precisa do início
// (ex: agregações tipo "faturamento do mês", sem limite superior porque é
// "desde o início do mês até agora").
export function inicioMesAtualBrasilia(agora: Date = new Date()): Date {
  const { ano, mes } = anoMesBrasilia(agora);
  return limitesMesBrasilia(ano, mes).inicio;
}

// A terceira combinação, que confunde à primeira vista: decidir QUAL é o mês
// corrente pelo calendário de Brasília, mas devolver a fronteira em UTC puro
// (sem o offset de +3h). É o que serve pra filtrar DATA-PURA (Despesa.
// vencimento) por "este mês": o campo é literal, então a comparação tem que
// ser em UTC puro — mas a pergunta "que mês é hoje?" continua sendo uma
// pergunta sobre o calendário de quem usa o sistema, não sobre o relógio do
// servidor. Sem isto, nas ~3h finais de cada dia a Vercel (UTC) já teria
// virado o mês e as despesas a vencer do mês corrente sumiriam da tela.
export function inicioMesAtualLiteralBrasilia(agora: Date = new Date()): Date {
  const { ano, mes } = anoMesBrasilia(agora);
  return new Date(Date.UTC(ano, mes - 1, 1));
}

// Fronteira de DIA no calendário de Brasília, a partir do valor cru de um
// <input type="date"> ("2026-08-14"). Mesmo raciocínio de limitesMesBrasilia,
// só que por dia — pra filtro de "de tal data até tal data" sobre coluna de
// INSTANTE REAL (createdAt, pagoEm). O fim é EXCLUSIVO: use `lt`, não `lte`,
// senão o último dia do intervalo entra pela metade.
//
// Não confundir com dataInputParaUTC logo acima: aquele é pra DATA-PURA
// (vencimento), e usar um no lugar do outro desloca o resultado em 3 horas
// justamente nas bordas, que é onde ninguém testa.
export function limitesDiaBrasilia(valorInput: string): { inicio: Date; fim: Date } {
  const [ano, mes, dia] = valorInput.split("-").map(Number);
  return {
    inicio: new Date(Date.UTC(ano, mes - 1, dia, OFFSET_BRASILIA_HORAS, 0, 0, 0)),
    fim: new Date(Date.UTC(ano, mes - 1, dia + 1, OFFSET_BRASILIA_HORAS, 0, 0, 0)),
  };
}

// Formatadores de INSTANTE REAL pra exibição — SEMPRE com
// `timeZone: "America/Sao_Paulo"` explícito, nunca deixar implícito (ver
// explicação acima). Contraste direto com `formatoData`, que é UTC de
// propósito pra data-pura — não trocar um pelo outro.
export const formatoInstanteReal = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
});

export const formatoInstanteRealHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatoInstanteRealComHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "medium",
});
