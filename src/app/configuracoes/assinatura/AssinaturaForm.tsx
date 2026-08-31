"use client";

import { useMemo, useState, useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { iniciarCheckout, abrirPortalCliente } from "./actions";
import { UsersIcon, TrendingUpIcon, BuildingIcon, CheckCircleIcon, SparklesIcon } from "@/components/icons";
import type { StatusAssinatura, PapelUsuario } from "@/generated/prisma/enums";
import type { Intervalo, Plano, PlanoId } from "@/lib/billing/planos";
import type { PlanoComPreco } from "@/lib/billing/precos";
import { formatarBytes, percentualUsado } from "@/lib/billing/limite-armazenamento";

// Cópia local dos 3 intervalos (não importa INTERVALOS de @/lib/billing/planos
// — esse módulo tem "server-only" no topo; um import de VALOR dele aqui
// arrastaria o módulo inteiro pro bundle do client component e quebra o
// build. Só importamos `type Intervalo` acima, que é apagado em tempo de
// compilação.
const INTERVALOS: Intervalo[] = ["mensal", "semestral", "anual"];

const ROTULO_TOGGLE_INTERVALO: Record<Intervalo, string> = {
  mensal: "Mensal",
  semestral: "Semestral",
  anual: "Anual",
};

const ROTULO_STATUS: Record<StatusAssinatura, string> = {
  TRIALING: "Em teste gratuito",
  ATIVA: "Ativa",
  INADIMPLENTE: "Pagamento pendente",
  CANCELADA: "Cancelada",
};

const COR_STATUS: Record<StatusAssinatura, string> = {
  TRIALING: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  ATIVA: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  INADIMPLENTE: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  CANCELADA: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

// Só cosmético (ícone + destaque visual do "Pro" como recomendado) — nunca
// afeta preço/limite, que continuam vindo 100% de `plano` (src/lib/billing/planos.ts).
const ESTILO_POR_PLANO: Record<PlanoId, { Icon: typeof UsersIcon; destaque: boolean }> = {
  basico: { Icon: UsersIcon, destaque: false },
  pro: { Icon: TrendingUpIcon, destaque: true },
  empresarial: { Icon: BuildingIcon, destaque: false },
};

function CardPlano({ plano, intervaloSelecionado }: { plano: PlanoComPreco; intervaloSelecionado: Intervalo }) {
  const [estado, acao, pending] = useActionState(iniciarCheckout, null);
  const { Icon, destaque } = ESTILO_POR_PLANO[plano.id];

  // Nem todo plano tem todo intervalo configurado no Stripe (semestral/anual
  // são opcionais por plano — ver planos.ts). Se o intervalo escolhido no
  // toggle global não existir pra ESTE plano, o card cai pro mensal em vez de
  // ficar sem preço/botão — decisão de UX: prefere sempre mostrar uma opção
  // funcional de assinar a esconder o card ou desabilitar o botão.
  const intervalo: Intervalo = plano.precos[intervaloSelecionado] ? intervaloSelecionado : "mensal";
  const preco = plano.precos[intervalo];

  const itens = [
    plano.limiteOrcamentosMes === null
      ? "Orçamentos por mês ilimitados"
      : `Até ${plano.limiteOrcamentosMes} orçamentos por mês`,
    plano.limiteUsuarios === null
      ? "Usuários ilimitados"
      : `Até ${plano.limiteUsuarios} usuário${plano.limiteUsuarios === 1 ? "" : "s"}`,
    `Até ${formatarBytes(plano.limiteArmazenamentoMb * 1024 * 1024)} de arquivos`,
  ];

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-white p-6 transition-shadow dark:bg-slate-900 ${
        destaque
          ? "border-teal-300 shadow-lg shadow-teal-600/10 dark:border-teal-800"
          : "border-slate-200 shadow-sm hover:shadow-md dark:border-slate-800"
      }`}
    >
      {destaque && (
        <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-teal-600 px-3 py-1 text-xs font-semibold text-white shadow-sm">
          <SparklesIcon className="h-3.5 w-3.5" />
          Mais popular
        </span>
      )}

      <span
        className={`flex h-11 w-11 items-center justify-center rounded-xl ${
          destaque
            ? "bg-teal-600 text-white"
            : "bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400"
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>

      <h3 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">{plano.nome}</h3>
      {preco && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {preco.precoFormatado.replace(/(\/[^/]+)$/, "")}
            <span className="text-sm font-medium text-slate-400">
              {preco.precoFormatado.match(/\/[^/]+$/)?.[0]}
            </span>
          </p>
          {intervalo !== "mensal" && preco.economiaPercentual !== null && preco.economiaPercentual > 0 && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Economize {preco.economiaPercentual}%
            </span>
          )}
        </div>
      )}
      <p className="mt-1 text-sm text-slate-500">{plano.descricao}</p>

      <ul className="mt-5 flex flex-col gap-2.5">
        {itens.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
            {item}
          </li>
        ))}
      </ul>

      {estado && !estado.ok && (
        <div className="mt-4">
          <Alert variant="error">{estado.mensagem}</Alert>
        </div>
      )}

      <form action={acao} className="mt-6">
        <input type="hidden" name="planoId" value={plano.id} />
        <input type="hidden" name="intervalo" value={intervalo} />
        <Button
          type="submit"
          variant={destaque ? "primary" : "outline"}
          loading={pending}
          className="w-full"
        >
          Assinar {plano.nome}
        </Button>
      </form>
    </div>
  );
}

export function AssinaturaForm({
  status,
  cortesia,
  souSuperAdmin,
  diasRestantesTrial,
  temStripeCustomer,
  mostrarPlanos,
  papel,
  planos,
  planoAtual,
  uso,
  diasAteBloqueio,
  armazenamentoUsadoBytes,
  armazenamentoLimiteBytes,
  armazenamentoEhTrial,
}: {
  status: StatusAssinatura;
  cortesia: boolean;
  souSuperAdmin: boolean;
  diasRestantesTrial: number | null;
  temStripeCustomer: boolean;
  mostrarPlanos: boolean;
  papel: PapelUsuario;
  planos: PlanoComPreco[];
  planoAtual: Plano | null;
  uso: { orcamentosMes: number; usuarios: number } | null;
  diasAteBloqueio: number | null;
  armazenamentoUsadoBytes: number;
  armazenamentoLimiteBytes: number;
  armazenamentoEhTrial: boolean;
}) {
  const percentualArmazenamento = percentualUsado({
    usadoBytes: armazenamentoUsadoBytes,
    limiteBytes: armazenamentoLimiteBytes,
  });
  const corBarraArmazenamento =
    percentualArmazenamento >= 95
      ? "bg-rose-600"
      : percentualArmazenamento >= 80
        ? "bg-amber-500"
        : "bg-teal-600";
  const [estadoPortal, acaoPortal, portalPending] = useActionState(abrirPortalCliente, null);

  // "ADMIN", não "Cortesia" — é o dono da plataforma, faz sentido a etiqueta
  // deixar isso claro em vez de soar como um desconto/favor concedido.
  const rotuloCortesia = souSuperAdmin ? "ADMIN" : "Cortesia";

  // Toggle global (Mensal/Semestral/Anual) aplicado aos 3 cards de uma vez —
  // padrão comum de página de preço SaaS, em vez de cada card ter o próprio
  // seletor. Só oferece um intervalo na aba se PELO MENOS UM plano tiver
  // aquele Price resolvido com sucesso (env var configurada + busca no
  // Stripe ok); se nenhum plano tiver semestral/anual configurado, a aba
  // nem aparece (evita um toggle que não muda nada). Cada CardPlano ainda
  // decide por conta própria se cai pro mensal quando O SEU plano específico
  // não tem o intervalo escolhido (ver CardPlano acima).
  const intervalosDisponiveis = useMemo(
    () => INTERVALOS.filter((intervalo) => planos.some((plano) => plano.precos[intervalo])),
    [planos]
  );
  const [intervaloSelecionado, setIntervaloSelecionado] = useState<Intervalo>("mensal");

  return (
    <div className="flex flex-col gap-8">
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              cortesia
                ? souSuperAdmin
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                : COR_STATUS[status]
            }`}
          >
            {cortesia ? rotuloCortesia : ROTULO_STATUS[status]}
          </span>
          {status === "TRIALING" && diasRestantesTrial !== null && (
            <span className="text-sm text-slate-500">
              {diasRestantesTrial > 0
                ? `${diasRestantesTrial} dia${diasRestantesTrial === 1 ? "" : "s"} restante${diasRestantesTrial === 1 ? "" : "s"} de teste`
                : "Teste expirado"}
            </span>
          )}
          {planoAtual && (
            <span className="text-sm text-slate-500">
              Plano: <strong className="font-semibold text-slate-700 dark:text-slate-200">{planoAtual.nome}</strong>
            </span>
          )}
        </div>

        {diasAteBloqueio !== null && (
          <Alert variant="error">
            Você passou do limite de uso do plano {planoAtual?.nome ?? "atual"} —{" "}
            {diasAteBloqueio > 0
              ? `faça upgrade em até ${diasAteBloqueio} dia${diasAteBloqueio === 1 ? "" : "s"} pra evitar o bloqueio.`
              : "o acesso será bloqueado a qualquer momento até o upgrade."}
          </Alert>
        )}

        {(uso || armazenamentoLimiteBytes > 0) && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            {uso && planoAtual && (
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs text-slate-500">Orçamentos este mês</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white">
                    {uso.orcamentosMes}
                    {planoAtual.limiteOrcamentosMes !== null && (
                      <span className="text-sm font-normal text-slate-400"> / {planoAtual.limiteOrcamentosMes}</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Usuários</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-white">
                    {uso.usuarios}
                    {planoAtual.limiteUsuarios !== null && (
                      <span className="text-sm font-normal text-slate-400"> / {planoAtual.limiteUsuarios}</span>
                    )}
                  </p>
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <p className="text-xs text-slate-500">Armazenamento</p>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {formatarBytes(armazenamentoUsadoBytes)} / {formatarBytes(armazenamentoLimiteBytes)}
                </p>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all ${corBarraArmazenamento}`}
                  style={{ width: `${percentualArmazenamento}%` }}
                />
              </div>
            </div>

            {percentualArmazenamento >= 90 && (
              <Alert variant="warning">
                Você já usou {Math.round(percentualArmazenamento)}% do seu espaço.{" "}
                {armazenamentoEhTrial
                  ? "Apague artes de pedidos antigos ou assine um plano pra liberar mais espaço."
                  : "Apague artes de pedidos antigos ou faça upgrade pra continuar enviando arquivos."}
              </Alert>
            )}
          </div>
        )}

        {papel !== "DONO" ? (
          <p className="text-sm text-slate-500">
            Só o DONO da gráfica pode assinar ou gerenciar a cobrança. Fale com
            ele se o acesso estiver bloqueado.
          </p>
        ) : (
          temStripeCustomer && (
            <div className="flex flex-col gap-3">
              {estadoPortal && !estadoPortal.ok && <Alert variant="error">{estadoPortal.mensagem}</Alert>}
              <form action={acaoPortal}>
                <Button type="submit" variant="outline" loading={portalPending}>
                  Gerenciar assinatura, trocar de plano e ver fatura
                </Button>
              </form>
            </div>
          )
        )}
      </Card>

      {mostrarPlanos && (
        <div className="flex flex-col gap-6">
          {intervalosDisponiveis.length > 1 && (
            <div className="flex justify-center">
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
                {intervalosDisponiveis.map((intervalo) => (
                  <button
                    key={intervalo}
                    type="button"
                    onClick={() => setIntervaloSelecionado(intervalo)}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                      intervaloSelecionado === intervalo
                        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                  >
                    {ROTULO_TOGGLE_INTERVALO[intervalo]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 pt-2 sm:grid-cols-3">
            {planos.map((plano) => (
              <CardPlano key={plano.id} plano={plano} intervaloSelecionado={intervaloSelecionado} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
