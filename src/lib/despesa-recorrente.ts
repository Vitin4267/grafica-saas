import "server-only";
import { prisma } from "@/lib/prisma";
import { ehViolacaoDeUnicidade } from "@/lib/prisma-conflito";

function proximoMes(data: Date): Date {
  const dia = data.getUTCDate();
  const inicioProximoMes = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 1));
  const ultimoDiaProximoMes = new Date(
    Date.UTC(inicioProximoMes.getUTCFullYear(), inicioProximoMes.getUTCMonth() + 1, 0)
  ).getUTCDate();
  inicioProximoMes.setUTCDate(Math.min(dia, ultimoDiaProximoMes));
  return inicioProximoMes;
}

function mesmoMesOuDepois(data: Date, referencia: Date): boolean {
  return (
    data.getUTCFullYear() > referencia.getUTCFullYear() ||
    (data.getUTCFullYear() === referencia.getUTCFullYear() &&
      data.getUTCMonth() >= referencia.getUTCMonth())
  );
}

const LIMITE_CATCH_UP = 24; // trava de segurança: no máximo 2 anos de ocorrências perdidas de uma vez

// Chamada sempre que a tela /financeiro carrega — idempotente (não faz nada
// se as séries já estão em dia). Cobre o caso de ninguém abrir o financeiro
// por mais de um mês seguido, avançando ocorrência por ocorrência até
// alcançar o mês atual. Só considera a ocorrência de vencimento MAIS RECENTE
// de cada série pra decidir se continua — ver comentário no schema.
export async function gerarDespesasRecorrentesPendentes(graficaId: string): Promise<void> {
  const series = await prisma.despesa.findMany({
    where: { graficaId, recorrente: true, serieRecorrenciaId: { not: null } },
    distinct: ["serieRecorrenciaId"],
    select: { serieRecorrenciaId: true },
  });

  const inicioMesAtual = new Date();
  inicioMesAtual.setUTCDate(1);
  inicioMesAtual.setUTCHours(0, 0, 0, 0);

  for (const { serieRecorrenciaId } of series) {
    if (!serieRecorrenciaId) continue;

    let ultima = await prisma.despesa.findFirst({
      where: { graficaId, serieRecorrenciaId },
      orderBy: { vencimento: "desc" },
    });

    if (!ultima || !ultima.recorrente) continue; // série foi desativada na ocorrência mais recente

    let seguranca = 0;
    while (!mesmoMesOuDepois(ultima.vencimento, inicioMesAtual) && seguranca < LIMITE_CATCH_UP) {
      try {
        ultima = await prisma.despesa.create({
          data: {
            graficaId,
            descricao: ultima.descricao,
            categoria: ultima.categoria,
            valor: ultima.valor,
            vencimento: proximoMes(ultima.vencimento),
            recorrente: true,
            serieRecorrenciaId,
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
      seguranca += 1;
    }
  }
}
