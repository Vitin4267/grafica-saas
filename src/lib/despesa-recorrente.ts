import "server-only";
import { prisma } from "@/lib/prisma";
import { ehViolacaoDeUnicidade } from "@/lib/prisma-conflito";
import type { PeriodicidadeDespesa } from "@/generated/prisma/enums";

function avancarMeses(data: Date, quantidade: number): Date {
  const dia = data.getUTCDate();
  const inicioMesAlvo = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + quantidade, 1));
  const ultimoDiaMesAlvo = new Date(
    Date.UTC(inicioMesAlvo.getUTCFullYear(), inicioMesAlvo.getUTCMonth() + 1, 0)
  ).getUTCDate();
  inicioMesAlvo.setUTCDate(Math.min(dia, ultimoDiaMesAlvo));
  return inicioMesAlvo;
}

function avancarDias(data: Date, dias: number): Date {
  const resultado = new Date(data);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado;
}

// Mantido pelo nome/assinatura original — src/lib/despesa-recorrente.test.ts
// testa a exceção de "dia inválido no mês seguinte" (ex: 31/08 -> 30/09)
// através dele.
export function proximoMes(data: Date): Date {
  return avancarMeses(data, 1);
}

// Um passo de avanço por periodicidade (enum PeriodicidadeDespesa no
// schema). Semanal/quinzenal avançam em dias corridos; as demais avançam em
// meses reaproveitando o mesmo ajuste de "dia inválido no mês seguinte" de
// avancarMeses (ex: dia 31 recorrente vira dia 30 num mês de 30 dias).
export function proximaOcorrencia(data: Date, periodicidade: PeriodicidadeDespesa): Date {
  switch (periodicidade) {
    case "SEMANAL":
      return avancarDias(data, 7);
    case "QUINZENAL":
      return avancarDias(data, 14);
    case "MENSAL":
      return avancarMeses(data, 1);
    case "BIMESTRAL":
      return avancarMeses(data, 2);
    case "TRIMESTRAL":
      return avancarMeses(data, 3);
    case "SEMESTRAL":
      return avancarMeses(data, 6);
    case "ANUAL":
      return avancarMeses(data, 12);
  }
}

export function mesmoMesOuDepois(data: Date, referencia: Date): boolean {
  return (
    data.getUTCFullYear() > referencia.getUTCFullYear() ||
    (data.getUTCFullYear() === referencia.getUTCFullYear() &&
      data.getUTCMonth() >= referencia.getUTCMonth())
  );
}

// Decide se a série já está em dia (não precisa gerar a próxima ocorrência
// ainda). SEMANAL/QUINZENAL comparam contra HOJE, não contra o mês: um
// bucket de mês pararia o catch-up assim que UMA ocorrência semanal caísse
// no mês corrente, mesmo faltando outras 2 ou 3 do mesmo mês pra série
// ficar em dia de verdade. As demais periodicidades (granularidade de 1 mês
// ou mais) continuam comparando contra o mês corrente — exatamente o
// comportamento de sempre pra MENSAL, e uma extensão razoável pras
// múltiplas de mês (bimestral/trimestral/semestral/anual): nunca gera uma
// ocorrência num mês além do corrente.
function jaEstaEmDia(
  vencimento: Date,
  periodicidade: PeriodicidadeDespesa,
  inicioMesAtual: Date,
  inicioHoje: Date
): boolean {
  if (periodicidade === "SEMANAL" || periodicidade === "QUINZENAL") {
    return vencimento.getTime() >= inicioHoje.getTime();
  }
  return mesmoMesOuDepois(vencimento, inicioMesAtual);
}

// Teto de CATCH-UP: quanto de calendário uma única chamada cobre de uma vez
// quando uma série ficou muito tempo sem gerar (ninguém abriu /financeiro).
// Um teto de CONTAGEM de ocorrências (o que existia antes deste achado, só
// pra periodicidade mensal) não generaliza entre periodicidades: 24
// ocorrências mensais são 2 anos perdidos, catch-up razoável — mas 24
// ocorrências ANUAIS seriam 24 ANOS de uma vez (sem sentido nenhum) e 24
// ocorrências SEMANAIS são só ~5,5 meses (baixo demais se a série ficou anos
// parada). Um teto de TEMPO cobre o mesmo período de calendário pra
// qualquer periodicidade — o resto do catch-up fica pra próxima vez que
// /financeiro carregar (o loop é idempotente e retoma de onde parou).
const MESES_CATCH_UP = 24;

// Chamada sempre que a tela /financeiro carrega — idempotente (não faz nada
// se as séries já estão em dia). Cobre o caso de ninguém abrir o financeiro
// por muito tempo, avançando ocorrência por ocorrência até alcançar o mês
// atual (ou até o teto de catch-up / recorrenciaAteEm, o que vier primeiro).
// Só considera a ocorrência de vencimento MAIS RECENTE de cada série pra
// decidir se continua — ver comentário no schema.
export async function gerarDespesasRecorrentesPendentes(graficaId: string): Promise<void> {
  const series = await prisma.despesa.findMany({
    where: { graficaId, recorrente: true, serieRecorrenciaId: { not: null } },
    distinct: ["serieRecorrenciaId"],
    select: { serieRecorrenciaId: true },
  });

  const inicioMesAtual = new Date();
  inicioMesAtual.setUTCDate(1);
  inicioMesAtual.setUTCHours(0, 0, 0, 0);

  const inicioHoje = new Date();
  inicioHoje.setUTCHours(0, 0, 0, 0);

  for (const { serieRecorrenciaId } of series) {
    if (!serieRecorrenciaId) continue;

    let ultima = await prisma.despesa.findFirst({
      where: { graficaId, serieRecorrenciaId },
      orderBy: { vencimento: "desc" },
    });

    if (!ultima || !ultima.recorrente) continue; // série foi desativada na ocorrência mais recente

    const limiteCatchUp = avancarMeses(ultima.vencimento, MESES_CATCH_UP);

    while (!jaEstaEmDia(ultima.vencimento, ultima.periodicidade, inicioMesAtual, inicioHoje)) {
      const proximoVencimento = proximaOcorrencia(ultima.vencimento, ultima.periodicidade);
      if (proximoVencimento > limiteCatchUp) break; // resto do catch-up fica pra próxima chamada
      if (ultima.recorrenciaAteEm && proximoVencimento > ultima.recorrenciaAteEm) break; // série encerrada

      try {
        ultima = await prisma.despesa.create({
          data: {
            graficaId,
            descricao: ultima.descricao,
            categoria: ultima.categoria,
            categoriaCustoId: ultima.categoriaCustoId,
            // valorVariavel: cada ocorrência nasce "a confirmar" (valor 0)
            // em vez de copiar o valor da anterior — ver badge em
            // src/app/financeiro/page.tsx.
            valor: ultima.valorVariavel ? 0 : ultima.valor,
            vencimento: proximoVencimento,
            recorrente: true,
            serieRecorrenciaId,
            periodicidade: ultima.periodicidade,
            recorrenciaAteEm: ultima.recorrenciaAteEm,
            valorVariavel: ultima.valorVariavel,
          },
        });
      } catch (erro) {
        // @@unique([serieRecorrenciaId, vencimento]) barrou — outra requisição
        // concorrente (duas abas abrindo /financeiro ao mesmo tempo) já criou
        // essa ocorrência. Ela cuida do catch-up dessa série; não há nada pra
        // essa chamada fazer além de parar por aqui.
        if (ehViolacaoDeUnicidade(erro)) break;
        throw erro;
      }
    }
  }
}
