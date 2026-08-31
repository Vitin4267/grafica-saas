import "server-only";

import { ROTULO_PLANO } from "@/lib/billing/recursos-pagos";

// O preço em si mora no Stripe (Product + Price), não duplicado aqui — evita
// duas fontes de verdade pro valor em R$. Limites de uso (orçamentos/mês,
// usuários) é que definem qual plano cada gráfica precisa — ver
// src/lib/billing/limite-uso.ts pra como isso é aplicado.
export type PlanoId = "basico" | "pro" | "empresarial";

// Os 3 intervalos de cobrança oferecidos. "mensal" é o único obrigatório —
// semestral/anual são opcionais por plano (ver DEFINICOES_PLANO/obterPlanos).
export type Intervalo = "mensal" | "semestral" | "anual";

export const INTERVALOS: Intervalo[] = ["mensal", "semestral", "anual"];

export type Plano = {
  id: PlanoId;
  nome: string;
  // Price ID do Stripe por intervalo. `mensal` nunca é null aqui — um plano
  // sem o Price mensal configurado nem aparece em obterPlanos() (mesmo
  // comportamento de antes). `semestral`/`anual` são opcionais por plano.
  precosPorIntervalo: { mensal: string; semestral: string | null; anual: string | null };
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
// reescrever nada além de adicionar/editar um item. `envVars` fica separado
// do valor resolvido de propósito: `/configuracoes/assinatura` é a tela de
// segurança pra quem está bloqueado, então NUNCA pode lançar erro só porque
// um dos Prices ainda não foi criado no Stripe — um plano sem a env var do
// Price MENSAL configurada nem aparece na lista (obterPlanos filtra), em vez
// de derrubar a página inteira; e um plano sem a env var de
// semestral/anual simplesmente não oferece aquele intervalo.
const DEFINICOES_PLANO: {
  id: PlanoId;
  nome: string;
  envVars: { mensal: string; semestral: string; anual: string };
  descricao: string;
  limiteOrcamentosMes: number | null;
  limiteUsuarios: number | null;
  limiteArmazenamentoMb: number;
}[] = [
  {
    id: "basico",
    nome: ROTULO_PLANO.basico,
    envVars: {
      mensal: "STRIPE_PRICE_ID_BASICO",
      semestral: "STRIPE_PRICE_ID_BASICO_SEMESTRAL",
      anual: "STRIPE_PRICE_ID_BASICO_ANUAL",
    },
    descricao: "Pra quem está começando: até 90 orçamentos por mês, até 2 usuários, 5GB de arquivos.",
    limiteOrcamentosMes: 90,
    limiteUsuarios: 2,
    limiteArmazenamentoMb: 5 * 1024,
  },
  {
    id: "pro",
    nome: ROTULO_PLANO.pro,
    envVars: {
      mensal: "STRIPE_PRICE_ID_PRO",
      semestral: "STRIPE_PRICE_ID_PRO_SEMESTRAL",
      anual: "STRIPE_PRICE_ID_PRO_ANUAL",
    },
    descricao: "Pra gráfica em crescimento: até 300 orçamentos por mês, até 8 usuários, 25GB de arquivos.",
    limiteOrcamentosMes: 300,
    limiteUsuarios: 8,
    limiteArmazenamentoMb: 25 * 1024,
  },
  {
    id: "empresarial",
    nome: ROTULO_PLANO.empresarial,
    envVars: {
      mensal: "STRIPE_PRICE_ID_EMPRESARIAL",
      semestral: "STRIPE_PRICE_ID_EMPRESARIAL_SEMESTRAL",
      anual: "STRIPE_PRICE_ID_EMPRESARIAL_ANUAL",
    },
    descricao: "Uso e usuários ilimitados, até 100GB de arquivos.",
    limiteOrcamentosMes: null,
    limiteUsuarios: null,
    limiteArmazenamentoMb: 100 * 1024,
  },
];

export function obterPlanos(): Plano[] {
  return DEFINICOES_PLANO.flatMap(({ envVars, ...definicao }) => {
    const mensal = process.env[envVars.mensal];
    // Sem o Price mensal, o plano inteiro não aparece — mesmo comportamento
    // de antes (era o único intervalo, então "sem envVar" = "sem plano").
    if (!mensal) return [];
    const semestral = process.env[envVars.semestral] ?? null;
    const anual = process.env[envVars.anual] ?? null;
    return [{ ...definicao, precosPorIntervalo: { mensal, semestral, anual } }];
  });
}

export function obterPlano(id: PlanoId): Plano {
  const plano = obterPlanos().find((p) => p.id === id);
  if (!plano) {
    throw new Error(`Plano "${id}" não está disponível — verifique se a env var do Price dele está configurada.`);
  }
  return plano;
}

// Resolve o Price ID de um (plano, intervalo) específico — usado no checkout
// (iniciarCheckout). Retorna null se aquele intervalo não estiver
// configurado pra este plano (ex: semestral sem env var ainda criada).
export function obterPriceId(id: PlanoId, intervalo: Intervalo): string | null {
  return obterPlano(id).precosPorIntervalo[intervalo];
}

// Reverse lookup — a partir do stripePriceId salvo em AssinaturaGrafica,
// descobre qual dos 3 planos é (não importa o intervalo: mensal, semestral e
// anual do mesmo tier resolvem pro mesmo Plano, já que o que muda por
// intervalo é só o Price no Stripe, não os limites/gating do tier). Retorna
// null pra price desconhecido (ex: gráfica grandfathered sem price nenhum,
// ou price nulo) — tratado como "sem limite aplicável" por quem chama, nunca
// como erro.
export function obterPlanoPorPriceId(stripePriceId: string | null): Plano | null {
  if (!stripePriceId) return null;
  return (
    obterPlanos().find((p) =>
      Object.values(p.precosPorIntervalo).includes(stripePriceId)
    ) ?? null
  );
}
