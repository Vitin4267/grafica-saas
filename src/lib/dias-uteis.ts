import "server-only";
import { prisma } from "@/lib/prisma";

// Fica FORA de src/lib/data.ts de propósito: aquele módulo é importado por
// vários componentes "use client" (ex: src/app/producao/PedidoLinha.tsx,
// src/app/orcamento/[id]/EtapasOrcamentoForm.tsx) — um import de
// @/lib/prisma ali quebraria o bundle do cliente (Prisma Client só roda em
// Node). Este arquivo é puro server (import "server-only" força o erro de
// build se algum "use client" tentar importar daqui).

const MS_POR_DIA = 86_400_000;

export type CalendarioTrabalho = {
  // Bitmask dos dias da semana em que a gráfica funciona — mesma convenção
  // de ParametrosGrafica.diasFuncionamento no schema: bit0=segunda,
  // bit1=terça, bit2=quarta, bit3=quinta, bit4=sexta, bit5=sábado,
  // bit6=domingo.
  diasFuncionamento: number;
  feriados: { data: Date; recorrenteAnual: boolean }[];
};

// `dataPura` é sempre meia-noite UTC representando um dia de calendário (ver
// comentário grande sobre DATA-PURA em src/lib/data.ts) — nunca um instante
// real, então getUTCDay/getUTCMonth/getUTCDate são seguros aqui, sem
// depender do fuso do processo. getUTCDay() devolve 0=domingo..6=sábado;
// "+6 % 7" remapeia domingo pro fim (bit6) em vez do início, batendo com a
// convenção bit0=segunda documentada no schema.
function ehDiaUtil(dataPura: Date, calendario: CalendarioTrabalho): boolean {
  const bit = (dataPura.getUTCDay() + 6) % 7;
  if (((calendario.diasFuncionamento >> bit) & 1) === 0) return false;

  const mes = dataPura.getUTCMonth();
  const dia = dataPura.getUTCDate();
  const ano = dataPura.getUTCFullYear();
  return !calendario.feriados.some((feriado) =>
    feriado.recorrenteAnual
      ? feriado.data.getUTCMonth() === mes && feriado.data.getUTCDate() === dia
      : feriado.data.getUTCFullYear() === ano &&
        feriado.data.getUTCMonth() === mes &&
        feriado.data.getUTCDate() === dia
  );
}

// Conta quantos dias ÚTEIS existem estritamente depois de `inicio` até
// `fim` (inclusive), segundo o calendário informado — usado pelo alerta de
// prazo por e-mail (src/lib/alerta-prazo-email.ts) pra saber "faltam quantos
// dias úteis pro prazo" em vez de dias corridos. Se `fim` já passou (<=
// `inicio`), devolve a diferença em dias corridos simples (negativa ou
// zero) — contar "dias úteis de atraso" não faz sentido pro caso já vencido,
// que é tratado à parte por quem chama.
export function contarDiasUteis(inicio: Date, fim: Date, calendario: CalendarioTrabalho): number {
  if (fim.getTime() <= inicio.getTime()) {
    return Math.round((fim.getTime() - inicio.getTime()) / MS_POR_DIA);
  }
  let cursor = inicio.getTime();
  let contagem = 0;
  while (cursor < fim.getTime()) {
    cursor += MS_POR_DIA;
    if (ehDiaUtil(new Date(cursor), calendario)) contagem += 1;
  }
  return contagem;
}

// Avança `n` dias a partir de `data` (uma DATA-PURA, meia-noite UTC — mesmo
// formato de Pedido.prazoEntrega) pulando fins de semana fora de
// ParametrosGrafica.diasFuncionamento e feriados cadastrados em
// FeriadoGrafica (exatos ou recorrentes anuais) — ou em dias corridos
// simples, se a gráfica cotar assim (ParametrosGrafica.prazoEmDiasUteis =
// false). Usado só pra SUGERIR o prazo de entrega na aprovação de um
// orçamento (ver src/app/orcamento/[id]/page.tsx) — o campo continua
// editável na tela, esta função nunca impõe o valor.
export async function somarDiasUteis(data: Date, n: number, graficaId: string): Promise<Date> {
  const parametros = await prisma.parametrosGrafica.findUnique({
    where: { graficaId },
    select: { prazoEmDiasUteis: true, diasFuncionamento: true },
  });

  if (parametros?.prazoEmDiasUteis === false) {
    return new Date(data.getTime() + n * MS_POR_DIA);
  }

  const feriados = await prisma.feriadoGrafica.findMany({
    where: { graficaId },
    select: { data: true, recorrenteAnual: true },
  });
  const calendario: CalendarioTrabalho = {
    diasFuncionamento: parametros?.diasFuncionamento ?? 31,
    feriados,
  };

  let resultado = data.getTime();
  let restantes = n;
  while (restantes > 0) {
    resultado += MS_POR_DIA;
    if (ehDiaUtil(new Date(resultado), calendario)) restantes -= 1;
  }
  return new Date(resultado);
}

// Feriados nacionais fixos do Brasil (data solar, se repetem todo ano) —
// ponto de partida sugerido na primeira vez que a gráfica abre a tela de
// feriados (ver garantirFeriadosNacionaisPadrao abaixo), mesmo espírito de
// CATEGORIAS_CUSTO_SUGERIDAS em src/lib/custo-pedido.ts. Feriados móveis
// (Carnaval, Sexta-feira Santa, Corpus Christi) ficam de fora de propósito:
// mudam de data todo ano (dependem do cálculo da Páscoa) — a gráfica
// recadastra esses manualmente, ano a ano, com recorrenteAnual=false.
export const FERIADOS_NACIONAIS_FIXOS = [
  { mes: 1, dia: 1, descricao: "Confraternização Universal" },
  { mes: 4, dia: 21, descricao: "Tiradentes" },
  { mes: 5, dia: 1, descricao: "Dia do Trabalho" },
  { mes: 9, dia: 7, descricao: "Independência do Brasil" },
  { mes: 10, dia: 12, descricao: "Nossa Senhora Aparecida" },
  { mes: 11, dia: 2, descricao: "Finados" },
  { mes: 11, dia: 15, descricao: "Proclamação da República" },
  { mes: 12, dia: 25, descricao: "Natal" },
] as const;

// Idempotente: só semeia os 8 feriados nacionais fixos se a gráfica ainda
// não tem NENHUM FeriadoGrafica cadastrado — mesma filosofia de
// garantirCategoriasCustoPadrao (src/lib/custo-pedido.ts). Se a gráfica já
// tinha feriados e apagou todos de propósito, isto nunca recria sozinho. O
// ano gravado em `data` é só um ponto de partida — recorrenteAnual=true faz
// somarDiasUteis/contarDiasUteis ignorarem o ano na comparação.
export async function garantirFeriadosNacionaisPadrao(graficaId: string): Promise<void> {
  const existentes = await prisma.feriadoGrafica.count({ where: { graficaId } });
  if (existentes > 0) return;

  const ano = new Date().getUTCFullYear();
  await prisma.feriadoGrafica.createMany({
    data: FERIADOS_NACIONAIS_FIXOS.map((feriado) => ({
      graficaId,
      data: new Date(Date.UTC(ano, feriado.mes - 1, feriado.dia)),
      descricao: feriado.descricao,
      recorrenteAnual: true,
    })),
  });
}
