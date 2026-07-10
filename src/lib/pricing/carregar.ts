import "server-only";

import { prisma } from "@/lib/prisma";
import type { ContextoPrecificacao, ParametrosTenant } from "./index";

// Único arquivo do motor que toca Prisma. Cruza Decimal do Prisma → number sempre
// aqui (via toString()/Number()), nunca dentro de src/lib/pricing/*.ts puro.
export async function carregarParametrosTenant(graficaId: string): Promise<ParametrosTenant> {
  // Self-healing: se a gráfica ainda não tem parâmetros (ex: tenants criados antes
  // dessa feature), cria uma linha com os defaults do schema na primeira leitura.
  const registro = await prisma.parametrosGrafica.upsert({
    where: { graficaId },
    update: {},
    create: { graficaId },
  });

  return {
    overheadPercent: Number(registro.overheadPercent),
    margemPadrao: Number(registro.margemPadrao),
    impostoPercent: Number(registro.impostoPercent),
    comissaoPercent: Number(registro.comissaoPercent),
    taxaFinanceiraPercent: Number(registro.taxaFinanceiraPercent),
    pedidoMinimo: Number(registro.pedidoMinimo),
    incrementoArredondamento: Number(registro.incrementoArredondamento),

    custoHoraMaq: Number(registro.custoHoraMaq),
    torres: registro.torres,
    custoChapa: Number(registro.custoChapa),
    folhasAcerto: registro.folhasAcerto,
    tempoAcertoH: Number(registro.tempoAcertoH),
    custoMilheiroRod: Number(registro.custoMilheiroRod),
    rodagemMinima: Number(registro.rodagemMinima),
    perdaPercentPadrao: Number(registro.perdaPercentPadrao),

    margemSegurancaPadrao: Number(registro.margemSegurancaPadrao),
    gapPecasPadrao: Number(registro.gapPecasPadrao),
  };
}

// Nesta fase, um PRODUTO em modo M2/OFFSET carrega suas próprias BobinaMaterial/
// FormatoFolha e seu próprio precoCompra como custo de material — ainda não existe
// um vínculo formal "produto usa esta outra matéria-prima do catálogo" (isso é
// trabalho de UI de uma próxima etapa). Pra "Banner em Lona", por exemplo, o
// precoCompra do próprio item já representa o custo do m² de lona.
export async function carregarContextoPrecificacao(
  itemGraficaId: string,
  graficaId: string
): Promise<ContextoPrecificacao> {
  const item = await prisma.itemGrafica.findFirstOrThrow({
    where: { id: itemGraficaId, graficaId },
    include: { bobinas: true, formatosFolha: true },
  });

  const parametros = await carregarParametrosTenant(graficaId);

  const contexto: ContextoPrecificacao = {
    itemGraficaId: item.id,
    modeloCalculo: item.modeloCalculo,
    viraFolha: item.viraFolha,
    parametros,
  };

  if (item.modeloCalculo === "M2") {
    contexto.m2 = {
      bobinas: item.bobinas.map((b) => ({
        id: b.id,
        larguraNominal: Number(b.larguraNominal),
        refile: Number(b.refile),
      })),
      custoM2Material: Number(item.precoCompra ?? 0),
      custoImpressaoM2: Number(item.custoImpressaoM2 ?? 0),
      areaMinimaFaturavel: Number(item.areaMinimaFaturavel ?? 0),
    };
  } else if (item.modeloCalculo === "OFFSET") {
    contexto.offset = {
      folhas: item.formatosFolha.map((f) => ({
        id: f.id,
        nome: f.nome,
        larguraFolha: Number(f.larguraFolha),
        alturaFolha: Number(f.alturaFolha),
      })),
      gramaturaGm2: Number(item.gramaturaGm2 ?? 0),
      precoPorKg: Number(item.precoPorKg ?? 0),
      viraFolha: item.viraFolha,
    };
  }

  return contexto;
}
