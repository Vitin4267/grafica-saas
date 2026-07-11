import Link from "next/link";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { calcularPrevisaoEstoque } from "@/lib/previsao-estoque-db";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon, BoxIcon } from "@/components/icons";

function chipUrgencia(diasRestantes: number | null, abaixoDoMinimo: boolean) {
  if (diasRestantes !== null && diasRestantes <= 7) {
    return (
      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        Crítico
      </span>
    );
  }
  if (diasRestantes !== null && diasRestantes <= 30) {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
        Atenção
      </span>
    );
  }
  if (diasRestantes !== null) {
    return (
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        Tranquilo
      </span>
    );
  }
  if (abaixoDoMinimo) {
    return (
      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        Abaixo do mínimo
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      Sem dados suficientes
    </span>
  );
}

export default async function PrevisaoEstoquePage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirVerModulo(usuario, "CATALOGO");

  const previsao = await calcularPrevisaoEstoque(usuario.graficaId);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/catalogo"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/catalogo"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao catálogo
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Previsão de estoque
          </h1>
          <p className="mt-1 text-slate-500">
            Calculado a partir do consumo real dos últimos 60 dias (saídas registradas na
            produção). Itens com pouco histórico ainda não têm previsão confiável.
          </p>
        </div>

        {previsao.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
              <BoxIcon className="h-6 w-6" />
            </span>
            <p className="text-sm text-slate-500">
              Nenhuma matéria-prima com estoque controlado ainda. Configure o estoque atual
              dos materiais no Catálogo.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100 dark:divide-slate-800">
            {previsao.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{item.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.categoria} · {item.estoqueAtual} {item.unidade} em estoque
                    {item.consumoMedioDiario !== null &&
                      ` · consome ~${item.consumoMedioDiario.toFixed(2)} ${item.unidade}/dia`}
                  </p>
                  {item.dataPrevistaEsgotamento && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Previsão de acabar em{" "}
                      {item.dataPrevistaEsgotamento.toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>
                {chipUrgencia(item.diasRestantes, item.abaixoDoMinimo)}
              </div>
            ))}
          </Card>
        )}
      </main>
    </div>
  );
}
