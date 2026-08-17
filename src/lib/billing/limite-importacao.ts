import "server-only";

import type { StatusAssinatura } from "@/generated/prisma/enums";
import type { PlanoId } from "@/lib/billing/planos";

// Cota MENSAL do Importador de planilha com IA — compartilhada entre os 3
// tipos (Clientes/Catálogo/Pedidos), nunca uma cota por tipo. Diferente de
// limiteOrcamentosMes/limiteUsuarios (src/lib/billing/planos.ts), fica FORA
// de DEFINICOES_PLANO de propósito: aquele teto é soft, com 15 dias de
// tolerância antes de bloquear o app inteiro (ver limite-uso.ts); este é um
// bloqueio DURO por chamada (mesmo espírito de recursos-pagos.ts), porque
// cada importação dispara uma chamada de IA que a plataforma paga na hora.
//
// TRIALING não tem PlanoId nenhum (só ganha price no checkout, ver
// obterPlanoPorPriceId) — todo outro gate hoje ou pula TRIALING inteiro
// (limite-uso.ts) ou bloqueia TRIALING inteiro (recursos-pagos.ts). Esta
// feature dá 1 chance no trial, decisão de produto explícita do dono
// (deixa a pessoa experimentar antes de assinar) — por isso o valor fica
// numa constante própria, não reaproveitando nenhum dos dois padrões acima.
export const LIMITE_IMPORTACAO_TRIAL = 1;

export const LIMITE_IMPORTACAO_MES: Record<PlanoId, number | null> = {
  basico: 5,
  pro: 15,
  empresarial: null, // null = ilimitado
};

export function resolverLimiteImportacaoMes(contexto: {
  status: StatusAssinatura | null;
  cortesia: boolean;
  planoId: PlanoId | null;
}): number | null {
  // Cortesia é override manual soberano, mesma regra de
  // podeUsarRecursoPago/assinaturaEstaLiberada — quem recebeu acesso
  // gratuito pelo /admin/graficas já teve o risco de custo avaliado na origem.
  if (contexto.cortesia) return null;
  if (contexto.status === "TRIALING") return LIMITE_IMPORTACAO_TRIAL;
  // Sem plano reconhecido (price desconhecido/env var faltando) e sem
  // trial = sem cota nenhuma. Fail-closed, mesmo raciocínio de
  // recursos-pagos.ts (cada chamada custa dinheiro real de IA) — diferente
  // de limite-uso.ts, que falha ABERTO porque aquele teto é só de contagem
  // de linha, sem custo de IA por trás.
  if (!contexto.planoId) return 0;
  return LIMITE_IMPORTACAO_MES[contexto.planoId];
}
