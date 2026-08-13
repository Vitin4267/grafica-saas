import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { podeVerMeuNegocio, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { TRIAL_DIAS, obterPlanos, obterPlanoPorPriceId } from "@/lib/billing/planos";
import { DIAS_TOLERANCIA_LIMITE } from "@/lib/billing/limite-uso";
import { calcularUsoAtual } from "@/lib/billing/uso";
import { anexarPrecos } from "@/lib/billing/precos";
import { calcularArmazenamentoUsado } from "@/lib/billing/armazenamento";
import { resolverLimiteArmazenamentoMb, mbParaBytes } from "@/lib/billing/limite-armazenamento";
import { UserNav } from "@/components/UserNav";
import { Alert } from "@/components/ui/Alert";
import { AssinaturaForm } from "./AssinaturaForm";

// Única outra tela do app sem exigirVerModulo/exigirAssinaturaAtiva (mesmo
// espírito de /comecar, ver src/lib/auth/permissoes.ts): é o destino de
// QUALQUER papel bloqueado por assinatura vencida ou limite de uso, então
// precisa carregar pra todo mundo, sempre — nunca pode virar loop de
// redirect.
export default async function ConfiguracoesAssinaturaPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  const { checkout } = await searchParams;

  // Self-healing, mesmo padrão de assistente/dadosFiscais: cria a linha em
  // TRIALING na primeira visita se por algum motivo ainda não existir
  // (gráficas normais já nascem com ela em registro/actions.ts).
  const trialExpiraEmPadrao = new Date();
  trialExpiraEmPadrao.setUTCDate(trialExpiraEmPadrao.getUTCDate() + TRIAL_DIAS);
  const assinatura = await prisma.assinaturaGrafica.upsert({
    where: { graficaId: usuario.graficaId },
    update: {},
    create: { graficaId: usuario.graficaId, status: "TRIALING", trialExpiraEm: trialExpiraEmPadrao },
  });

  // react-hooks/purity (regra nova do eslint-config-next 16.2.11, pensada
  // pra Client Component/React Compiler) marca Date.now() como "impuro
  // durante a renderização" — mas isto aqui é um Server Component: roda uma
  // vez por request no servidor, não há re-render concorrente pra esse
  // valor divergir. Uma leitura de relógio por request é exatamente o
  // comportamento desejado (calcular "dias restantes" no momento em que a
  // página é gerada).
  // eslint-disable-next-line react-hooks/purity
  const agora = Date.now();
  const diasRestantesTrial = assinatura.trialExpiraEm
    ? Math.ceil((assinatura.trialExpiraEm.getTime() - agora) / 86_400_000)
    : null;

  const planoAtual = obterPlanoPorPriceId(assinatura.stripePriceId);
  const uso = assinatura.status === "ATIVA" ? await calcularUsoAtual(usuario.graficaId) : null;

  // Sem condicionar ao status, ao contrário de `uso` acima — armazenamento é
  // o único indicador que também vale durante o trial. Usa a `assinatura`
  // recém lida/upsertada nesta página (não usuario.grafica.assinatura, que
  // pode estar desatualizada na primeira visita — ver self-healing acima).
  const armazenamentoLimiteMb = resolverLimiteArmazenamentoMb({
    status: assinatura.status,
    cortesia: assinatura.cortesia,
    plano: planoAtual,
  });
  const armazenamentoEhTrial = assinatura.status === "TRIALING" && !planoAtual;
  const armazenamentoUsadoBytes = await calcularArmazenamentoUsado(usuario.graficaId);
  const armazenamentoLimiteBytes = mbParaBytes(armazenamentoLimiteMb);

  const diasAteBloqueio = assinatura.limiteExcedidoDesde
    ? DIAS_TOLERANCIA_LIMITE -
      Math.floor((agora - assinatura.limiteExcedidoDesde.getTime()) / 86_400_000)
    : null;

  // Mostra os cards de plano pra quem PODE (re)assinar: DONO, sem cortesia, e
  // sem assinatura paga viva (TRIALING = ainda não assinou; CANCELADA = já foi
  // cliente mas cancelou — precisa poder voltar a assinar pelo site, não só
  // pelo Portal). ATIVA/INADIMPLENTE têm assinatura viva no Stripe: gerenciam
  // pelo Customer Portal (evita criar uma segunda assinatura/cobrança). Antes
  // dependia de !stripeCustomerId, o que travava pra sempre quem já tinha sido
  // cliente uma vez. Só busca preço no Stripe quando os cards vão aparecer.
  const mostrarCardsDePlano =
    usuario.papel === "DONO" &&
    !assinatura.cortesia &&
    (assinatura.status === "TRIALING" || assinatura.status === "CANCELADA");
  const planos = mostrarCardsDePlano ? await anexarPrecos(obterPlanos()) : [];

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/configuracoes/assinatura"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Assinatura
          </h1>
          <p className="mt-1 text-slate-500">
            Cobrança do uso do grafica-saas. Sem assinatura ativa (ou trial
            válido), o acesso ao sistema fica bloqueado pra toda a equipe.
          </p>
        </div>

        {checkout === "sucesso" && (
          <div className="mb-6">
            <Alert variant="success">
              Checkout concluído! Pode levar alguns segundos pro status
              atualizar aqui — recarregue a página se ainda mostrar
              pendente.
            </Alert>
          </div>
        )}
        {checkout === "cancelado" && (
          <div className="mb-6">
            <Alert variant="error">Checkout cancelado — nenhuma cobrança foi feita.</Alert>
          </div>
        )}

        <AssinaturaForm
          status={assinatura.status}
          cortesia={assinatura.cortesia}
          souSuperAdmin={usuario.superAdmin}
          diasRestantesTrial={diasRestantesTrial}
          temStripeCustomer={Boolean(assinatura.stripeCustomerId)}
          mostrarPlanos={mostrarCardsDePlano}
          papel={usuario.papel}
          planos={planos}
          planoAtual={planoAtual}
          uso={uso}
          diasAteBloqueio={diasAteBloqueio}
          armazenamentoUsadoBytes={armazenamentoUsadoBytes}
          armazenamentoLimiteBytes={armazenamentoLimiteBytes}
          armazenamentoEhTrial={armazenamentoEhTrial}
        />
      </main>
    </div>
  );
}
