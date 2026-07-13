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
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon, BuildingIcon } from "@/components/icons";
import { NovaFilialForm } from "./NovaFilialForm";

export default async function FiliaisPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const filiais = await prisma.filial.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: { nome: "asc" },
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/configuracoes"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/configuracoes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar a Configurações
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Filiais</h1>
          <p className="mt-1 text-slate-500">
            Catálogo, estoque e financeiro continuam únicos pra gráfica toda —
            uma filial só marca em qual unidade um orçamento foi feito, pra
            relatório.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-3">
          {filiais.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhuma filial cadastrada ainda — crie a primeira abaixo.
              </p>
            </Card>
          )}
          {filiais.map((filial) => (
            <Link key={filial.id} href={`/configuracoes/filiais/${filial.id}`}>
              <Card className="flex items-center justify-between p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                    <BuildingIcon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">
                      {filial.nome}
                    </p>
                    {filial.endereco && (
                      <p className="mt-0.5 text-xs text-slate-500">{filial.endereco}</p>
                    )}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    filial.ativa
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {filial.ativa ? "Ativa" : "Inativa"}
                </span>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Nova filial
            </h2>
            <NovaFilialForm />
          </Card>
        )}
      </main>
    </div>
  );
}
