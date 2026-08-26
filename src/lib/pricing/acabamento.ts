import { type Dec, paraDecimal, maiorDec } from "./decimal";
import { ErroPrecificacao } from "./erros";
import type { ConfigAcabamento, ContextoAcabamento } from "./tipos";

// Base de cobrança genérica (spec §3) — o detalhe que mais gente erra no mercado:
// FOLHA_IMPRESSA cobra pela folha de máquina ANTES do refile (ex: BOPP em offset),
// nunca pela peça final, senão o custo sai errado em uma ordem de grandeza.
export function calcularQtdBase(config: ConfigAcabamento, ctx: ContextoAcabamento): Dec {
  switch (config.baseCobranca) {
    case "UNIDADE":
      return paraDecimal(ctx.quantidade);

    case "M2":
      return paraDecimal(ctx.quantidade).times(ctx.larguraEfetivaM).times(ctx.alturaEfetivaM);

    case "FOLHA_IMPRESSA": {
      if (ctx.folhasBoas === undefined || ctx.folhasPerda === undefined) {
        throw new ErroPrecificacao(
          "CUSTO_INVALIDO",
          `Acabamento "${config.nome}" cobra por folha impressa, mas este item não usa o motor offset (não há folhas calculadas).`,
          { itemGraficaId: config.itemGraficaId }
        );
      }
      return paraDecimal(ctx.folhasBoas + ctx.folhasPerda);
    }

    case "METRO_LINEAR": {
      if (ctx.perimetroOuEmenda === undefined) {
        throw new ErroPrecificacao(
          "CUSTO_INVALIDO",
          `Acabamento "${config.nome}" cobra por metro linear, mas nenhum perímetro/emenda foi informado.`,
          { itemGraficaId: config.itemGraficaId }
        );
      }
      return paraDecimal(ctx.quantidade).times(ctx.perimetroOuEmenda);
    }

    case "FIXO":
      return paraDecimal(1);

    case "HORA": {
      if (ctx.horasEstimadas === undefined) {
        throw new ErroPrecificacao(
          "CUSTO_INVALIDO",
          `Acabamento "${config.nome}" cobra por hora, mas nenhuma estimativa de horas foi informada.`,
          { itemGraficaId: config.itemGraficaId }
        );
      }
      return paraDecimal(ctx.horasEstimadas);
    }

    case "MILHEIRO":
      return paraDecimal(ctx.quantidade).div(1000);

    case "CENTO":
      return paraDecimal(ctx.quantidade).div(100);
  }
}

export function calcularCustoAcabamento(config: ConfigAcabamento, ctx: ContextoAcabamento): Dec {
  const qtdBase = calcularQtdBase(config, ctx);
  const custoVariavel = paraDecimal(config.custoSetup).plus(
    qtdBase.times(config.custoUnitario)
  );
  const custo = maiorDec(paraDecimal(config.custoMinimo), custoVariavel);
  const ferramental = paraDecimal(config.custoFerramental ?? 0);
  return custo.plus(ferramental);
}

export type ItemAcabamentoCalculado = {
  itemGraficaId: string;
  nome: string;
  qtdBase: Dec;
  custo: Dec;
};

export function calcularAcabamentos(
  configs: ConfigAcabamento[],
  ctx: ContextoAcabamento
): { itens: ItemAcabamentoCalculado[]; total: Dec } {
  const itens = configs.map((config) => ({
    itemGraficaId: config.itemGraficaId,
    nome: config.nome,
    qtdBase: calcularQtdBase(config, ctx),
    custo: calcularCustoAcabamento(config, ctx),
  }));

  const total = itens.reduce((soma, item) => soma.plus(item.custo), paraDecimal(0));

  return { itens, total };
}
