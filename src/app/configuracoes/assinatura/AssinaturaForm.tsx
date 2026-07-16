"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { iniciarCheckout, abrirPortalCliente } from "./actions";
import { UsersIcon, TrendingUpIcon, BuildingIcon, CheckCircleIcon, SparklesIcon } from "@/components/icons";
import type { StatusAssinatura, PapelUsuario } from "@/generated/prisma/enums";
import type { Plano, PlanoId } from "@/lib/billing/planos";
import type { PlanoComPreco } from "@/lib/billing/precos";

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

function CardPlano({ plano }: { plano: PlanoComPreco }) {
  const [estado, acao, pending] = useActionState(iniciarCheckout, null);
  const { Icon, destaque } = ESTILO_POR_PLANO[plano.id];

  const itens = [
    plano.limiteOrcamentosMes === null
      ? "Orçamentos por mês ilimitados"
      : `Até ${plano.limiteOrcamentosMes} orçamentos por mês`,
    plano.limiteUsuarios === null
      ? "Usuários ilimitados"
      : `Até ${plano.limiteUsuarios} usuário${plano.limiteUsuarios === 1 ? "" : "s"}`,
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
      {plano.precoFormatado && (
        <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
          {plano.precoFormatado.replace(/(\/\w+)$/, "")}
          <span className="text-sm font-medium text-slate-400">
            {plano.precoFormatado.match(/\/\w+$/)?.[0]}
          </span>
        </p>
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
}) {
  const [estadoPortal, acaoPortal, portalPending] = useActionState(abrirPortalCliente, null);

  // "ADMIN", não "Cortesia" — é o dono da plataforma, faz sentido a etiqueta
  // deixar isso claro em vez de soar como um desconto/favor concedido.
  const rotuloCortesia = souSuperAdmin ? "ADMIN" : "Cortesia";

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

        {uso && planoAtual && (
          <div className="flex flex-wrap gap-6 border-t border-slate-100 pt-4 dark:border-slate-800">
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
        <div className="grid grid-cols-1 gap-6 pt-2 sm:grid-cols-3">
          {planos.map((plano) => (
            <CardPlano key={plano.id} plano={plano} />
          ))}
        </div>
      )}
    </div>
  );
}
