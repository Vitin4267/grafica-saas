import "server-only";

import { ROTULO_PLANO } from "@/lib/billing/recursos-pagos";

// O preço em si mora no Stripe (Product + Price), não duplicado aqui — evita
// duas fontes de verdade pro valor em R$. Limites de uso (orçamentos/mês,
// usuários) é que definem qual plano cada gráfica precisa — ver
// src/lib/billing/limite-uso.ts pra como isso é aplicado.
export type PlanoId = "basico" | "pro" | "empresarial";

export type Plano = {
  id: PlanoId;
  nome: string;
  stripePriceId: string;
  descricao: string;
  limiteOrcamentosMes: number | null; // null = ilimitado
  limiteUsuarios: number | null; // null = ilimitado
  // Nunca null, ao contrário dos dois de cima: armazenamento tem custo
  // direto e recorrente pra plataforma (Vercel Blob), diferente de
  // orçamento/usuário (linha de banco, custo marginal ~zero) — "ilimitado"
  // aqui seria repasse de custo sem teto num plano de preço fixo. Ver
  // src/lib/billing/limite-armazenamento.ts.
  limiteArmazenamentoMb: number;
};

export const TRIAL_DIAS = 14;

// Valores placeholder (o usuário ajusta preço/limites depois no dashboard
// do Stripe e aqui) — a estrutura em lista já está pronta pra crescer sem
// reescrever nada além de adicionar/editar um item. `envVar` fica separado
// do valor resolvido de propósito: `/configuracoes/assinatura` é a tela de
// segurança pra quem está bloqueado, então NUNCA pode lançar erro só porque
// um dos 3 Prices ainda não foi criado no Stripe — um plano sem a env var
// configurada simplesmente não aparece na lista (obterPlanos filtra),
// em vez de derrubar a página inteira.
const DEFINICOES_PLANO: {
  id: PlanoId;
  nome: string;
  envVar: string;
  descricao: string;
  limiteOrcamentosMes: number | null;
  limiteUsuarios: number | null;
  limiteArmazenamentoMb: number;
}[] = [
  {
    id: "basico",
    nome: ROTULO_PLANO.basico,
    envVar: "STRIPE_PRICE_ID_BASICO",
    descricao: "Pra quem está começando: até 90 orçamentos por mês, até 2 usuários, 5GB de arquivos.",
    limiteOrcamentosMes: 90,
    limiteUsuarios: 2,
    limiteArmazenamentoMb: 5 * 1024,
  },
  {
    id: "pro",
    nome: ROTULO_PLANO.pro,
    envVar: "STRIPE_PRICE_ID_PRO",
    descricao: "Pra gráfica em crescimento: até 300 orçamentos por mês, até 8 usuários, 25GB de arquivos.",
    limiteOrcamentosMes: 300,
    limiteUsuarios: 8,
    limiteArmazenamentoMb: 25 * 1024,
  },
  {
    id: "empresarial",
    nome: ROTULO_PLANO.empresarial,
    envVar: "STRIPE_PRICE_ID_EMPRESARIAL",
    descricao: "Uso e usuários ilimitados, até 100GB de arquivos.",
    limiteOrcamentosMes: null,
    limiteUsuarios: null,
    limiteArmazenamentoMb: 100 * 1024,
  },
];

export function obterPlanos(): Plano[] {
  return DEFINICOES_PLANO.flatMap(({ envVar, ...definicao }) => {
    const stripePriceId = process.env[envVar];
    return stripePriceId ? [{ ...definicao, stripePriceId }] : [];
  });
}

export function obterPlano(id: PlanoId): Plano {
  const plano = obterPlanos().find((p) => p.id === id);
  if (!plano) {
    throw new Error(`Plano "${id}" não está disponível — verifique se a env var do Price dele está configurada.`);
  }
  return plano;
}

// Reverse lookup — a partir do stripePriceId salvo em AssinaturaGrafica,
// descobre qual dos 3 planos é. Retorna null pra price desconhecido (ex:
// gráfica grandfathered sem price nenhum, ou price nulo) — tratado como
// "sem limite aplicável" por quem chama, nunca como erro.
export function obterPlanoPorPriceId(stripePriceId: string | null): Plano | null {
  if (!stripePriceId) return null;
  return obterPlanos().find((p) => p.stripePriceId === stripePriceId) ?? null;
}
