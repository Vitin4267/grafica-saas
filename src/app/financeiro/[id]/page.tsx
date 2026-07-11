import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { dataParaInputValue } from "@/lib/data";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { DespesaForm } from "./DespesaForm";

export default async function DespesaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirVerModulo(usuario, "FINANCEIRO");
  const podeEditar = await podeEditarModulo(usuario, "FINANCEIRO");

  const despesa = await prisma.despesa.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });

  if (!despesa) {
    notFound();
  }

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
        <Link
          href="/financeiro"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao financeiro
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {despesa.descricao}
          </h1>
        </div>

        <DespesaForm
          despesaId={despesa.id}
          valoresIniciais={{
            descricao: despesa.descricao,
            categoria: despesa.categoria ?? "",
            valor: despesa.valor.toString(),
            vencimento: dataParaInputValue(despesa.vencimento),
          }}
          status={despesa.status}
          pagoEm={despesa.pagoEm ? dataParaInputValue(despesa.pagoEm) : null}
          formaPagamento={despesa.formaPagamento}
          recorrente={despesa.recorrente}
          podeEditar={podeEditar}
        />
      </main>
    </div>
  );
}
