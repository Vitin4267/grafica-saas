import Link from "next/link";
import { formatoMoeda } from "@/lib/moeda";
import { formatoData } from "@/lib/data";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { buscarHistoricoCliente } from "@/lib/historico-cliente";

// Achado A10 da Parte 5 da auditoria de abrangência (2026-08-30) — a ficha do
// cliente era só o formulário de edição, sem nenhuma visão financeira ou de
// histórico. Puramente apresentação: toda a busca/agregação vive em
// buscarHistoricoCliente (src/lib/historico-cliente.ts), testável sem
// renderizar React.
export async function HistoricoClienteCard({
  graficaId,
  clienteId,
}: {
  graficaId: string;
  clienteId: string;
}) {
  const historico = await buscarHistoricoCliente(graficaId, clienteId);

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Faturamento (últimos 12 meses)
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500">Faturado</p>
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              {formatoMoeda.format(historico.faturamentoPeriodo.faturado)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Pedidos</p>
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              {historico.faturamentoPeriodo.pedidos}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Ticket médio</p>
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              {historico.faturamentoPeriodo.ticketMedio !== null
                ? formatoMoeda.format(historico.faturamentoPeriodo.ticketMedio)
                : "—"}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Últimos orçamentos</h2>
        {historico.orcamentosRecentes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Nenhum orçamento cadastrado ainda pra este cliente.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {historico.orcamentosRecentes.map((o) => (
              <Link
                key={o.id}
                href={`/orcamento/${o.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge
                    status={o.statusPedido ?? o.status}
                    tipo={o.statusPedido ? "pedido" : "orcamento"}
                  />
                  <span className="text-slate-500">{formatoData.format(o.createdAt)}</span>
                </div>
                <span className="font-medium text-slate-900 dark:text-white">
                  {formatoMoeda.format(o.total)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Contas a receber em aberto
          </h2>
          <Link
            href="/financeiro/contas-receber"
            className="text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
          >
            Ver Financeiro
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">Em aberto</p>
            <p className="mt-1 text-lg font-bold text-amber-600 dark:text-amber-400">
              {formatoMoeda.format(historico.totalEmAberto)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Vencido</p>
            <p className="mt-1 text-lg font-bold text-rose-600 dark:text-rose-400">
              {formatoMoeda.format(historico.totalVencido)}
            </p>
          </div>
        </div>
        {historico.contasEmAberto.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nenhuma conta em aberto pra este cliente.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {historico.contasEmAberto.map((c) => (
              <Link
                key={c.id}
                href={`/orcamento/${c.orcamentoId}`}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{c.descricao}</p>
                  <p className={c.vencida ? "text-rose-600 dark:text-rose-400" : "text-slate-500"}>
                    Vence em {formatoData.format(c.vencimento)}
                  </p>
                </div>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {formatoMoeda.format(c.saldo)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
