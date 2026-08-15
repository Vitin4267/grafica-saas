import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { formatoMoeda } from "@/lib/moeda";
import { formatoData, dataEhPassado } from "@/lib/data";
import { gerarDespesasRecorrentesPendentes } from "@/lib/despesa-recorrente";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NovaDespesaForm } from "./NovaDespesaForm";

function statusPill(status: "PENDENTE" | "PAGA", vencimento: Date) {
  if (status === "PAGA") {
    return (
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        Paga
      </span>
    );
  }
  if (dataEhPassado(vencimento)) {
    return (
      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        Atrasada
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
      Pendente
    </span>
  );
}

export default async function FinanceiroPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");
  const podeEditar = await podeEditarModulo(usuario, "FINANCEIRO");

  await gerarDespesasRecorrentesPendentes(usuario.graficaId);

  const despesas = await prisma.despesa.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: [{ status: "asc" }, { vencimento: "asc" }],
  });

  const mesAtual = new Date().toISOString().slice(0, 7);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/financeiro"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Financeiro
          </h1>
          <p className="mt-1 text-slate-500">
            Contas a pagar da gráfica — fornecedor, aluguel, contas fixas.
            Complementa os pagamentos que você já recebe dos clientes.
          </p>
        </div>

        <Card className="mb-8 flex flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between">
          <form action="/financeiro/exportar" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Relatório do mês
              </span>
              <input
                type="month"
                name="mes"
                defaultValue={mesAtual}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <Button type="submit" variant="outline">
              Baixar CSV pro contador
            </Button>
          </form>
          <div className="flex flex-col gap-1 text-sm sm:items-end">
            <Link href="/financeiro/comissoes" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
              Ver comissões →
            </Link>
            <Link href="/financeiro/contas-prepagas" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
              Ver contas prepagas →
            </Link>
            <Link href="/financeiro/auditoria" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
              Ver trilha de auditoria →
            </Link>
          </div>
        </Card>

        <div className="mb-8 flex flex-col gap-3">
          {despesas.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhuma despesa cadastrada ainda — crie a primeira abaixo.
              </p>
            </Card>
          )}
          {despesas.map((despesa) => (
            <Link key={despesa.id} href={`/financeiro/${despesa.id}`}>
              <Card className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {despesa.descricao}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {despesa.recorrente ? "🔁 Recorrente · " : ""}
                    {despesa.categoria ? `${despesa.categoria} · ` : ""}
                    Vence em {formatoData.format(despesa.vencimento)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {formatoMoeda.format(Number(despesa.valor))}
                  </p>
                  {statusPill(despesa.status, despesa.vencimento)}
                </div>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Nova despesa
            </h2>
            <NovaDespesaForm />
          </Card>
        )}
      </main>
    </div>
  );
}
