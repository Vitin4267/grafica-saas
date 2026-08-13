// Puro (sem "server-only", sem Prisma) — testável isolado, mesmo padrão de
// src/lib/billing/limite-uso.ts. Sem "server-only" de propósito, ao
// contrário de planos.ts: a UI de botão bloqueado (client component) precisa
// importar ROTULO_PLANO/mensagemRecursoBloqueado sem puxar o resto do
// billing (que depende de env var/Prisma) pro bundle do navegador — mesma
// separação já usada entre src/lib/modulos-permissao.ts (neutro) e
// src/lib/auth/permissoes.ts (server-only).
import type { StatusAssinatura } from "@/generated/prisma/enums";
import type { PlanoId } from "@/lib/billing/planos";

// Ordem de preço, do mais barato pro mais caro — fonte única dos rótulos de
// plano (planos.ts consome ROTULO_PLANO daqui, pra não existir uma segunda
// lista de nomes que possa divergir).
export const ORDEM_PLANOS: readonly PlanoId[] = ["basico", "pro", "empresarial"];

export const ROTULO_PLANO: Record<PlanoId, string> = {
  basico: "Básico",
  pro: "Pro",
  empresarial: "Empresarial",
};

export type RecursoPago = "calculo_tinta_ia";

// TABELA ÚNICA de recursos que custam dinheiro real por uso (armazenamento
// de imagem + token de IA na conta da PLATAFORMA, não da gráfica) e de quais
// planos podem usá-los. Adicionar um recurso novo = uma linha aqui + a
// chamada de verificarRecursoPago (src/lib/auth/recurso-pago.ts) na action
// dele. Nada mais.
//
// Invariante (testada em recursos-pagos.test.ts): os planos elegíveis são
// sempre um SUFIXO de ORDEM_PLANOS — nunca ["basico","empresarial"] pulando
// o "pro" do meio. É o que garante que a mensagem automática "disponível a
// partir do plano X" nunca minta pro cliente.
export const RECURSOS_PAGOS: Record<RecursoPago, readonly PlanoId[]> = {
  calculo_tinta_ia: ["pro", "empresarial"],
};

export type AcessoRecursoPago =
  | { liberado: true }
  | {
      liberado: false;
      // "assinatura" = não tem plano pago vivo (trial, inadimplente,
      // cancelada) — o CTA é assinar. "plano" = paga, mas no plano errado —
      // o CTA é fazer upgrade. A UI usa isso pra escolher o texto do link.
      motivo: "assinatura" | "plano";
      mensagem: string;
      planosElegiveis: readonly PlanoId[];
    };

export function planosElegiveis(recurso: RecursoPago): readonly PlanoId[] {
  return RECURSOS_PAGOS[recurso];
}

export function mensagemRecursoBloqueado(recurso: RecursoPago): string {
  const elegiveis = planosElegiveis(recurso);
  const maisBarato = ORDEM_PLANOS.find((p) => elegiveis.includes(p));
  if (!maisBarato) return "Recurso indisponível.";
  return elegiveis.length === 1
    ? `Disponível no plano ${ROTULO_PLANO[maisBarato]}.`
    : `Disponível a partir do plano ${ROTULO_PLANO[maisBarato]}.`;
}

// Quem chama já resolveu o planoId a partir do stripePriceId (ver
// src/lib/auth/recurso-pago.ts).
//
// ATENÇÃO — ESTE GATE FALHA FECHADO, ao contrário do resto do billing
// (limite-uso.ts/assinatura.ts: plano não reconhecido = "sem limite
// aplicável", ou seja LIBERA — certo pra um teto de uso, já que um erro de
// configuração nunca deve trancar um cliente pagante fora do produto). Aqui
// é o oposto: cada uso gasta dinheiro real da plataforma (imagem + token de
// IA), então dúvida = bloqueio. Se a env var de um Price sumir, o pior que
// acontece é um cliente Pro ver "faça upgrade" (visível, corrigível em 1
// minuto); no sentido contrário, o pior é a conta de IA sendo consumida em
// silêncio por quem não paga por ela.
export function podeUsarRecursoPago(
  recurso: RecursoPago,
  contexto: {
    status: StatusAssinatura | null;
    cortesia: boolean;
    planoId: PlanoId | null;
  }
): AcessoRecursoPago {
  const elegiveis = planosElegiveis(recurso);

  // Cortesia é override manual soberano, mesma regra de
  // assinaturaEstaLiberada (src/lib/billing/status.ts): quem recebeu acesso
  // gratuito pelo /admin/graficas recebeu do próprio dono da plataforma, um
  // por um — o risco de custo já foi avaliado na origem. Sem esta linha,
  // toda gráfica de cortesia (sem stripePriceId nenhum) cairia no
  // fail-closed abaixo.
  if (contexto.cortesia) return { liberado: true };

  // TRIALING/INADIMPLENTE/CANCELADA/sem assinatura → bloqueado. Trial não
  // tem plano nenhum (só ganha stripePriceId no checkout) — "liberar no
  // trial" seria liberar pra 100% dos cadastros, sem cartão, por 14 dias.
  if (contexto.status !== "ATIVA") {
    return {
      liberado: false,
      motivo: "assinatura",
      mensagem: mensagemRecursoBloqueado(recurso),
      planosElegiveis: elegiveis,
    };
  }

  // planoId null = price desconhecido/ausente (grandfathered, env var
  // faltando) — fail-closed, ver comentário acima da função.
  if (!contexto.planoId || !elegiveis.includes(contexto.planoId)) {
    return {
      liberado: false,
      motivo: "plano",
      mensagem: mensagemRecursoBloqueado(recurso),
      planosElegiveis: elegiveis,
    };
  }

  return { liberado: true };
}
