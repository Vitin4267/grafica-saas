import "server-only";
import { prisma } from "@/lib/prisma";
import { calcularAliquotaEfetivaSimples, type AliquotaSimplesCalculada } from "@/lib/simples-nacional";

const MESES_RBT12 = 12;

// RBT12 — faturamento bruto acumulado nos 12 meses anteriores, a base legal
// da progressividade do Simples Nacional (LC 123/2006, art. 18, §1º).
//
// Fonte de dado escolhida: Orcamento aprovado por data de CRIAÇÃO (excluindo
// pedido cancelado), a MESMA base que buscarVisaoGeralNegocio
// (src/lib/meu-negocio.ts) já usa pra "faturamentoMes"/topClientes — regime
// de COMPETÊNCIA (a venda reconhecida), que é o que a lei do Simples
// enxerga como "receita bruta auferida". Pagamento (a base de saldoReal em
// meu-negocio.ts) é regime de CAIXA — quando o dinheiro efetivamente entrou,
// uma pergunta diferente (fluxo de caixa) e pior proxy fiscal aqui: um
// orçamento de R$80mil aprovado e parcelado em 90 dias já é receita bruta
// auferida pra lei mesmo sem 1 centavo recebido ainda. Mesma exclusão de
// pedido cancelado que faturamentoAgregado (achado N2 — pedido cancelado
// não é venda de verdade).
export async function calcularRbt12(graficaId: string): Promise<number> {
  const agora = new Date();
  const dozeMesesAtras = new Date(agora);
  dozeMesesAtras.setUTCMonth(dozeMesesAtras.getUTCMonth() - MESES_RBT12);

  const agregado = await prisma.orcamento.aggregate({
    where: {
      graficaId,
      status: "APROVADO",
      createdAt: { gte: dozeMesesAtras },
      NOT: { pedido: { status: "CANCELADO" } },
    },
    _sum: { total: true },
  });

  return Number(agregado._sum.total ?? 0);
}

export type SituacaoAliquotaSimples = AliquotaSimplesCalculada & {
  rbt12: number;
  impostoConfigurado: number; // ParametrosGrafica.impostoPercent, decimal
};

// null quando a comparação não se aplica: regime != SIMPLES_NACIONAL (achado
// A10 restringe de propósito — Presumido/Real não têm essa progressividade
// por faturamento, motor tributário completo é fora de escopo) ou
// DadosFiscaisGrafica ainda não cadastrado (gráfica não configurou fiscal
// ainda, nada a comparar).
export async function calcularSituacaoAliquotaSimples(
  graficaId: string
): Promise<SituacaoAliquotaSimples | null> {
  const [dadosFiscais, parametros] = await Promise.all([
    prisma.dadosFiscaisGrafica.findUnique({
      where: { graficaId },
      select: { regimeTributario: true },
    }),
    prisma.parametrosGrafica.findUnique({
      where: { graficaId },
      select: { impostoPercent: true },
    }),
  ]);

  if (!dadosFiscais || dadosFiscais.regimeTributario !== "SIMPLES_NACIONAL" || !parametros) {
    return null;
  }

  const rbt12 = await calcularRbt12(graficaId);
  const calculo = calcularAliquotaEfetivaSimples(rbt12);

  return {
    ...calculo,
    rbt12,
    impostoConfigurado: Number(parametros.impostoPercent),
  };
}
