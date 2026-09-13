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

// Achado B6 da auditoria do motor de preço (2026-09-13) — ctx.horasEstimadas
// é UM número por ITEM, não por acabamento (ver ContextoAcabamento em
// tipos.ts). Com 2+ configs de baseCobranca=HORA no mesmo item, calcularQtdBase
// devolveria o MESMO ctx.horasEstimadas pras duas — cobrando a mesma
// estimativa duas vezes (ex: "Instalação" R$50/h + "Criação de arte" R$80/h,
// 4h estimadas só pra uma delas, cobradas nas duas = R$520 em vez do real).
// orcamento-precificacao.ts já bloqueia essa combinação na camada de
// aplicação — esta é a defesa em profundidade do motor puro, pro caso de
// alguém chamar precificar()/calcularAcabamentos direto sem passar por lá.
export function calcularAcabamentos(
  configs: ConfigAcabamento[],
  ctx: ContextoAcabamento
): { itens: ItemAcabamentoCalculado[]; total: Dec } {
  const configsHora = configs.filter((c) => c.baseCobranca === "HORA");
  if (configsHora.length > 1) {
    throw new ErroPrecificacao(
      "ACABAMENTOS_HORA_AMBIGUOS",
      `Este item tem ${configsHora.length} acabamentos cobrados por hora (${configsHora.map((c) => c.nome).join(", ")}) — a estimativa de horas é única por item, o motor não sabe dividir entre eles.`,
      { acabamentos: configsHora.map((c) => c.nome) }
    );
  }

  const itens = configs.map((config) => ({
    itemGraficaId: config.itemGraficaId,
    nome: config.nome,
    qtdBase: calcularQtdBase(config, ctx),
    custo: calcularCustoAcabamento(config, ctx),
  }));

  const total = itens.reduce((soma, item) => soma.plus(item.custo), paraDecimal(0));

  return { itens, total };
}
