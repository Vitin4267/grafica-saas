// Sem "server-only" de propósito: este módulo é puro (nenhum acesso a banco/
// filesystem/env) e vai ser importado tanto por Server Components/Actions
// quanto por um client component (formulário de item de orçamento, numa
// etapa futura) — ver AGENTS.md da feature "unidade de dimensão".
//
// Unidade canônica do banco continua sendo SEMPRE centímetro
// (OrcamentoItem.larguraCm/alturaCm, ambos Decimal(8,2) no schema — ver
// prisma/schema.prisma). O que este módulo resolve é só a camada de
// ENTRADA e EXIBIÇÃO: a gráfica escolhe uma unidade padrão (Grafica.
// unidadePadraoDimensao) e, mais tarde, cada item de orçamento poderá
// escolher a própria — mas o valor gravado nunca muda de unidade.

import Decimal from "decimal.js";

// Instância própria (não a de src/lib/pricing/decimal.ts): este arquivo
// precisa continuar livre de qualquer dependência do motor de precificação
// pra poder ser importado num client component sem puxar código que só faz
// sentido no servidor. `decimal.js` já é dependência do projeto (usada lá),
// então não é uma biblioteca nova — só uma instância isolada.
const D = Decimal.clone({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export const UNIDADES_DIMENSAO = ["MM", "CM", "M"] as const;
export type UnidadeDimensao = (typeof UNIDADES_DIMENSAO)[number];

export const ROTULO_UNIDADE_DIMENSAO: Record<UnidadeDimensao, string> = {
  MM: "mm",
  CM: "cm",
  M: "m",
};

// Quantos centímetros vale 1 unidade — todos os fatores são potência de 10
// (mm↔cm↔m), o que é exatamente o caso em que ponto flutuante binário (IEEE
// 754) sofre: 10 não é potência de 2, então frações como 0.1 ou 0.01 não têm
// representação binária exata (o clássico 0.1 + 0.2 !== 0.3). Cálculo de
// dimensão físico entrando/saindo do motor de precificação não pode carregar
// esse tipo de ruído — por isso as conversões abaixo passam por Decimal
// (aritmética decimal exata, mesma abordagem de src/lib/pricing/decimal.ts
// pro dinheiro) em vez de fazer `valor * fator` direto em number.
const FATOR_PARA_CM: Record<UnidadeDimensao, string> = {
  MM: "0.1",
  CM: "1",
  M: "100",
};

// Casas decimais que cada unidade precisa pra representar EXATAMENTE a
// resolução da coluna no banco (Decimal(8,2) em centímetros, ou seja, o
// menor incremento gravável é 0,01cm = 0,1mm = 0,0001m). Usado só na
// exibição (converterDeCm) pra não imprimir lixo de arredondamento tipo
// "12.340000000000001mm" — a conversão em si (via Decimal) já é exata, isto
// aqui só decide quantas casas mostrar.
const CASAS_EXIBICAO: Record<UnidadeDimensao, number> = {
  MM: 1,
  CM: 2,
  M: 4,
};

// Casas decimais da própria coluna no banco (larguraCm/alturaCm são
// Decimal(8,2)) — toda conversão PARA cm arredonda pra isso, senão o Prisma
// erraria ao tentar persistir um valor com mais casas do que a coluna aceita.
const CASAS_CM_BANCO = 2;

// Entrada do usuário (na unidade escolhida pela gráfica/item) → valor
// canônico em centímetros, já arredondado pra precisão da coluna no banco.
//
// Não valida sinal nem exige > 0: dimensão física "deveria" ser positiva,
// mas essa regra de negócio pertence ao formulário/Zod que chama esta
// função (ex: src/app/orcamento/actions.ts), não a uma função de conversão
// pura. Aqui 0 e negativos são convertidos matematicamente como qualquer
// outro valor — mantém a função simples e testável isoladamente.
export function converterParaCm(valor: number, unidade: UnidadeDimensao): number {
  return new D(valor).times(FATOR_PARA_CM[unidade]).toDecimalPlaces(CASAS_CM_BANCO).toNumber();
}

// Valor gravado no banco (sempre cm) → valor pra exibir/editar na unidade
// escolhida. Mesma observação sobre sinal: não normaliza negativo pra 0,
// só converte — dado inconsistente no banco não é problema desta função.
export function converterDeCm(valorCm: number, unidade: UnidadeDimensao): number {
  return new D(valorCm).div(FATOR_PARA_CM[unidade]).toDecimalPlaces(CASAS_EXIBICAO[unidade]).toNumber();
}

// `step` sugerido pro <input type="number"> de cada unidade. mm nasce
// inteiro (ninguém digita fração de milímetro numa etiqueta); m precisa de
// casas decimais (senão só seria possível pedir metros inteiros, inútil
// pra lona/banner); cm fica no meio, uma casa decimal cobre a prática usual
// sem abrir mão de precisão.
export function passoInputDimensao(unidade: UnidadeDimensao): string {
  const passos: Record<UnidadeDimensao, string> = {
    MM: "1",
    CM: "0.1",
    M: "0.01",
  };
  return passos[unidade];
}
