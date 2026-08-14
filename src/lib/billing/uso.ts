import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { UsoAtual } from "@/lib/billing/limite-uso";

// Início do mês corrente em UTC — mesmo cuidado de fuso já usado em
// src/lib/data.ts (data pura sempre em UTC, nunca depende de onde o
// processo roda).
function inicioDoMesUTC(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
}

async function buscarUsoAtual(graficaId: string): Promise<UsoAtual> {
  const [orcamentosMes, usuarios] = await Promise.all([
    prisma.orcamento.count({
      where: { graficaId, createdAt: { gte: inicioDoMesUTC() } },
    }),
    // Funcionário removido (desativadoEm preenchido) não ocupa vaga — remover
    // alguém precisa liberar espaço pra convidar outra pessoa na hora, não só
    // depois de o histórico dele "sair" do banco (o que nunca acontece,
    // por design — ver comentário de Usuario.desativadoEm).
    prisma.usuario.count({ where: { graficaId, desativadoEm: null } }),
  ]);
  return { orcamentosMes, usuarios };
}

// exigirAssinaturaAtiva() chama isto em toda navegação autenticada — cache
// de 60s por gráfica (tag `uso-${graficaId}`) evita recontar orçamentos/
// usuários toda hora. Invalidação sob demanda via updateTag (read-your-own-
// writes, expira na hora — Next 16 trocou o revalidateTag de 1 argumento
// por um que exige profile e passou a ser stale-while-revalidate por
// padrão, então updateTag é o certo aqui dentro de Server Actions) nos
// lugares que mudam essas contagens (criar/cancelar orçamento, criar
// usuário — ver src/app/orcamento/actions.ts,
// src/app/orcamento/[id]/actions.ts, src/app/usuarios/actions.ts); os 60s
// de TTL são só rede de segurança — irrelevante mesmo se ficar
// momentaneamente desatualizado, já que o bloqueio por limite excedido já
// tem 15 dias de tolerância (ver src/lib/billing/limite-uso.ts).
export function calcularUsoAtual(graficaId: string): Promise<UsoAtual> {
  return unstable_cache(buscarUsoAtual, ["uso-atual"], {
    tags: [`uso-${graficaId}`],
    revalidate: 60,
  })(graficaId);
}
