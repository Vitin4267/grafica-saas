import "server-only";

import { prisma } from "@/lib/prisma";
import { ErroPrecificacao } from "./erros";
import { resolverPrecoPapel } from "./papel";
import type {
  ConfigAcabamento,
  ContextoPrecificacao,
  ParametrosImpressoraDigital,
  ParametrosMaquinaFlexo,
  ParametrosMaquinaSetupPorPeca,
  ParametrosPrensa,
  ParametrosTenant,
} from "./index";

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

    margemSegurancaPadrao: Number(registro.margemSegurancaPadrao),
    gapPecasPadrao: Number(registro.gapPecasPadrao),
  };
}

// Diferente de carregarParametrosTenant, não é self-healing — uma prensa só existe
// se o usuário criou uma em Configurações > Prensas. Chamador (carregarContextoPrecificacao)
// já garante que só chama isso com um prensaId real.
export async function carregarParametrosPrensa(
  prensaId: string,
  graficaId: string
): Promise<ParametrosPrensa> {
  const registro = await prisma.prensa.findFirstOrThrow({
    where: { id: prensaId, graficaId },
  });

  return {
    custoHoraMaq: Number(registro.custoHoraMaq),
    torres: registro.torres,
    custoChapa: Number(registro.custoChapa),
    folhasAcerto: registro.folhasAcerto,
    tempoAcertoH: Number(registro.tempoAcertoH),
    custoMilheiroRod: Number(registro.custoMilheiroRod),
    rodagemMinima: Number(registro.rodagemMinima),
    perdaPercentPadrao: Number(registro.perdaPercentPadrao),
  };
}

// Diferente de carregarParametrosTenant, não é self-healing — uma máquina flexo só
// existe se o usuário criou uma em Configurações > Máquinas Flexo. Chamador
// (carregarContextoPrecificacao) já garante que só chama isso com um id real.
export async function carregarParametrosMaquinaFlexografia(
  maquinaFlexografiaId: string,
  graficaId: string
): Promise<ParametrosMaquinaFlexo> {
  const registro = await prisma.maquinaFlexografia.findFirstOrThrow({
    where: { id: maquinaFlexografiaId, graficaId },
  });

  return {
    custoHoraMaq: Number(registro.custoHoraMaq),
    numeroEstacoesCores: registro.numeroEstacoesCores,
    larguraMaquinaM: Number(registro.larguraMaquinaM),
    passoCilindroM: Number(registro.passoCilindroM),
    tempoAcertoH: Number(registro.tempoAcertoH),
    metrosAcerto: Number(registro.metrosAcerto),
    custoMetroLinearRod: Number(registro.custoMetroLinearRod),
    rodagemMinima: Number(registro.rodagemMinima),
    perdaPercentPadrao: Number(registro.perdaPercentPadrao),
  };
}

// Diferente de carregarParametrosTenant, não é self-healing — uma impressora
// digital só existe se o usuário criou uma em Configurações > Máquinas >
// Impressão Digital. Chamador (carregarContextoPrecificacao) já garante que
// só chama isso com um impressoraDigitalId real.
export async function carregarParametrosImpressoraDigital(
  impressoraDigitalId: string,
  graficaId: string
): Promise<ParametrosImpressoraDigital> {
  const registro = await prisma.impressoraDigital.findFirstOrThrow({
    where: { id: impressoraDigitalId, graficaId },
  });

  return {
    custoPorClique: Number(registro.custoPorClique),
  };
}

// Diferente de carregarParametrosTenant, não é self-healing — uma máquina de
// setup por peça só existe se o usuário criou uma em Configurações >
// Máquinas > Serigrafia/Sublimação/Estampagem. Chamador
// (carregarContextoPrecificacao) já garante que só chama isso com um
// maquinaSetupPorPecaId real.
export async function carregarParametrosMaquinaSetupPorPeca(
  maquinaSetupPorPecaId: string,
  graficaId: string
): Promise<ParametrosMaquinaSetupPorPeca> {
  const registro = await prisma.maquinaSetupPorPeca.findFirstOrThrow({
    where: { id: maquinaSetupPorPecaId, graficaId },
  });

  return {
    custoPorSetup: Number(registro.custoPorSetup),
    custoPorPeca: Number(registro.custoPorPeca),
    custoMinimo: Number(registro.custoMinimo),
  };
}

// Nesta fase, um PRODUTO em modo M2/OFFSET carrega suas próprias BobinaMaterial/
// FormatoFolha e seu próprio precoCompra como custo de material — ainda não existe
// um vínculo formal "produto usa esta outra matéria-prima do catálogo", EXCETO
// quando o produto tem ConfiguracaoClicheEtiqueta (motor de clichê de etiqueta):
// nesse caso, `dadosEtiqueta.papelId` aponta pra uma matéria-prima escolhida NO
// ORÇAMENTO, e o custo de material vem de lá, não do precoCompra do produto. Pra
// "Banner em Lona" (M2 sem essa config), o precoCompra do próprio item continua
// representando o custo do m² de lona, exatamente como antes.
export async function carregarContextoPrecificacao(
  itemGraficaId: string,
  graficaId: string,
  dadosEtiqueta?: { papelId: string; quantidadeCores: number }
): Promise<ContextoPrecificacao> {
  const item = await prisma.itemGrafica.findFirstOrThrow({
    where: { id: itemGraficaId, graficaId },
    include: {
      bobinas: true,
      formatosFolha: true,
      prensa: true,
      papel: { include: { tabelaPrecoPapel: true } },
      configuracaoClicheEtiqueta: true,
      maquinaFlexografia: true,
      configuracaoClicheFlexografia: true,
      impressoraDigital: true,
      maquinaSetupPorPeca: true,
    },
  });

  const parametros = await carregarParametrosTenant(graficaId);

  const contexto: ContextoPrecificacao = {
    itemGraficaId: item.id,
    modeloCalculo: item.modeloCalculo,
    viraFolha: item.viraFolha,
    parametros,
  };

  if (item.modeloCalculo === "M2") {
    let custoM2Material = Number(item.precoCompra ?? 0);

    if (item.configuracaoClicheEtiqueta) {
      if (!dadosEtiqueta) {
        throw new ErroPrecificacao(
          "ETIQUETA_SEM_PAPEL",
          "Este produto usa o motor de clichê de etiqueta — escolha o papel e o número de cores."
        );
      }

      const papel = await prisma.itemGrafica.findFirst({
        where: {
          id: dadosEtiqueta.papelId,
          graficaId,
          ativo: true,
          itemCatalogo: { tipo: "MATERIA_PRIMA" },
        },
      });
      if (!papel) {
        throw new ErroPrecificacao(
          "PAPEL_INVALIDO",
          "O papel escolhido não é válido — verifique se ele ainda existe e está ativo no catálogo."
        );
      }

      custoM2Material = Number(papel.precoCompra ?? 0);
      contexto.etiquetaCliche = {
        quantidadeCores: dadosEtiqueta.quantidadeCores,
        custoClichePorCm2: Number(item.configuracaoClicheEtiqueta.custoClichePorCm2),
      };
    }

    contexto.m2 = {
      bobinas: item.bobinas.map((b) => ({
        id: b.id,
        larguraNominal: Number(b.larguraNominal),
        refile: Number(b.refile),
      })),
      custoM2Material,
      custoImpressaoM2: Number(item.custoImpressaoM2 ?? 0),
      areaMinimaFaturavel: Number(item.areaMinimaFaturavel ?? 0),
    };
  } else if (item.modeloCalculo === "OFFSET") {
    if (!item.prensa) {
      throw new ErroPrecificacao(
        "PRENSA_NAO_CONFIGURADA",
        "Este produto usa o modelo Offset mas não tem uma prensa selecionada — configure isso na tela do produto, no catálogo."
      );
    }
    if (!item.papel) {
      throw new ErroPrecificacao(
        "PAPEL_NAO_CONFIGURADO",
        "Este produto usa o modelo Offset mas não tem um papel selecionado — configure isso na tela do produto, no catálogo."
      );
    }

    const gramaturaEscolhida = Number(item.gramaturaGm2 ?? 0);
    const { precoKg } = resolverPrecoPapel(
      item.papel.tabelaPrecoPapel.map((linha) => ({
        gramatura: linha.gramatura,
        precoKg: Number(linha.precoKg),
      })),
      gramaturaEscolhida
    );

    contexto.offset = {
      folhas: item.formatosFolha.map((f) => ({
        id: f.id,
        nome: f.nome,
        larguraFolha: Number(f.larguraFolha),
        alturaFolha: Number(f.alturaFolha),
      })),
      gramaturaGm2: gramaturaEscolhida,
      precoPorKg: precoKg,
      viraFolha: item.viraFolha,
    };
    contexto.parametrosPrensa = await carregarParametrosPrensa(item.prensa.id, graficaId);
    contexto.prensaUsada = { id: item.prensa.id, nome: item.prensa.nome };
  } else if (item.modeloCalculo === "FLEXOGRAFIA") {
    if (!item.maquinaFlexografia) {
      throw new ErroPrecificacao(
        "MAQUINA_FLEXO_NAO_CONFIGURADA",
        "Este produto usa o modelo Flexografia mas não tem uma máquina selecionada — configure isso na tela do produto, no catálogo."
      );
    }
    if (!item.configuracaoClicheFlexografia) {
      throw new ErroPrecificacao(
        "CLICHE_FLEXO_NAO_CONFIGURADO",
        "Este produto usa o modelo Flexografia mas não tem o custo de clichê configurado — configure isso na tela do produto, no catálogo."
      );
    }

    contexto.flexografia = {
      bobinas: item.bobinas.map((b) => ({
        id: b.id,
        larguraNominal: Number(b.larguraNominal),
        refile: Number(b.refile),
      })),
      custoM2Material: Number(item.precoCompra ?? 0),
    };
    contexto.parametrosMaquinaFlexo = await carregarParametrosMaquinaFlexografia(
      item.maquinaFlexografia.id,
      graficaId
    );
    contexto.maquinaFlexoUsada = { id: item.maquinaFlexografia.id, nome: item.maquinaFlexografia.nome };
    contexto.clicheFlexo = {
      custoClichePorCm2: Number(item.configuracaoClicheFlexografia.custoClichePorCm2),
    };
  } else if (item.modeloCalculo === "DIGITAL") {
    if (!item.impressoraDigital) {
      throw new ErroPrecificacao(
        "IMPRESSORA_DIGITAL_NAO_CONFIGURADA",
        "Este produto usa o modelo Digital mas não tem uma impressora selecionada — configure isso na tela do produto, no catálogo."
      );
    }

    contexto.digital = {
      custoSubstratoPorPeca: Number(item.precoCompra ?? 0),
    };
    contexto.parametrosImpressoraDigital = await carregarParametrosImpressoraDigital(
      item.impressoraDigital.id,
      graficaId
    );
    contexto.impressoraDigitalUsada = { id: item.impressoraDigital.id, nome: item.impressoraDigital.nome };
  } else if (
    item.modeloCalculo === "SERIGRAFIA" ||
    item.modeloCalculo === "SUBLIMACAO" ||
    item.modeloCalculo === "ESTAMPAGEM_QUENTE" ||
    item.modeloCalculo === "PERSONALIZACAO"
  ) {
    if (!item.maquinaSetupPorPeca) {
      throw new ErroPrecificacao(
        "MAQUINA_SETUP_POR_PECA_NAO_CONFIGURADA",
        "Este produto usa um modelo de setup por peça mas não tem uma máquina selecionada — configure isso na tela do produto, no catálogo."
      );
    }

    contexto.setupPorPeca = {
      custoSubstratoPorPeca: Number(item.precoCompra ?? 0),
    };
    contexto.parametrosMaquinaSetupPorPeca = await carregarParametrosMaquinaSetupPorPeca(
      item.maquinaSetupPorPeca.id,
      graficaId
    );
    contexto.maquinaSetupPorPecaUsada = {
      id: item.maquinaSetupPorPeca.id,
      nome: item.maquinaSetupPorPeca.nome,
    };
  } else if (item.modeloCalculo === "REVENDA") {
    // Default do catálogo — OrcamentoItem.custoAquisicaoUnitario (override
    // POR ORÇAMENTO) não é campo de ItemGrafica, então não existe aqui; quem
    // chama (calcularItemOrcamento) sobrescreve contexto.revenda depois desta
    // função quando o orçamento informou um valor (mesmo padrão de
    // contexto.horasEstimadas, ver src/lib/orcamento-precificacao.ts).
    contexto.revenda = {
      custoAquisicaoUnitario: Number(item.precoCompra ?? 0),
    };
  }

  return contexto;
}

// Traduz os ItemGrafica escolhidos como acabamento (motor M2/OFFSET, ver
// calcularItemOrcamento) pro shape que o motor de custo entende. Cada um precisa
// ser um SERVICO do catálogo da própria gráfica com ConfiguracaoAcabamento
// cadastrada — sem isso não tem como saber base de cobrança/custo.
export async function resolverConfigAcabamentos(
  itemGraficaIds: string[],
  graficaId: string
): Promise<ConfigAcabamento[]> {
  const itens = await prisma.itemGrafica.findMany({
    where: { id: { in: itemGraficaIds }, graficaId },
    include: { itemCatalogo: true, configuracaoAcabamento: true },
  });

  if (itens.length !== itemGraficaIds.length) {
    throw new ErroPrecificacao(
      "CUSTO_INVALIDO",
      "Um ou mais acabamentos selecionados não foram encontrados."
    );
  }

  return itemGraficaIds.map((id) => {
    // findMany não garante ordem == itemGraficaIds; busca item a item pra manter
    // a mensagem de erro e o resultado alinhados com o que o usuário escolheu.
    const item = itens.find((i) => i.id === id)!;
    if (item.itemCatalogo.tipo !== "SERVICO" || !item.configuracaoAcabamento) {
      throw new ErroPrecificacao(
        "CUSTO_INVALIDO",
        `"${item.itemCatalogo.nome}" não está configurado como acabamento — configure em Catálogo antes de usar.`
      );
    }

    return {
      itemGraficaId: item.id,
      nome: item.itemCatalogo.nome,
      baseCobranca: item.configuracaoAcabamento.baseCobranca,
      estagio: item.configuracaoAcabamento.estagio,
      custoUnitario: Number(item.precoCompra ?? 0),
      custoSetup: Number(item.configuracaoAcabamento.custoSetup),
      custoMinimo: Number(item.configuracaoAcabamento.custoMinimo),
      custoFerramental:
        item.configuracaoAcabamento.custoFerramental !== null
          ? Number(item.configuracaoAcabamento.custoFerramental)
          : null,
    };
  });
}
