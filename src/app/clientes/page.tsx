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
import { UsersIcon } from "@/components/icons";
import { ClienteForm } from "./ClienteForm";

export default async function ClientesPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CLIENTES");
  const podeEditar = await podeEditarModulo(usuario, "CLIENTES");

  const clientes = await prisma.cliente.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: { nome: "asc" },
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/clientes"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Clientes</h1>
            <p className="mt-1 text-slate-500">
              Cadastre seus clientes uma vez e reaproveite em todos os orçamentos.
            </p>
          </div>
          {podeEditar && (
            <Link
              href="/importar/clientes"
              className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Importar de planilha
            </Link>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
          {podeEditar && (
            <Card className="p-6 lg:col-span-2">
              <h2 className="mb-5 text-base font-semibold text-slate-900 dark:text-white">
                Novo cliente
              </h2>
              <ClienteForm />
            </Card>
          )}

          <div className={podeEditar ? "lg:col-span-3" : "lg:col-span-5"}>
            {clientes.length === 0 ? (
              <Card className="flex flex-col items-center gap-3 p-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                  <UsersIcon className="h-6 w-6" />
                </span>
                <p className="text-sm text-slate-500">
                  Nenhum cliente cadastrado ainda. Use o formulário ao lado para
                  cadastrar o primeiro.
                </p>
              </Card>
            ) : (
              <Card className="divide-y divide-slate-100 dark:divide-slate-800">
                {clientes.map((cliente) => (
                  <Link
                    key={cliente.id}
                    href={`/clientes/${cliente.id}`}
                    className="flex items-center gap-3 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                      <UsersIcon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">
                        {cliente.nome}
                      </p>
                      <p className="text-sm text-slate-500">
                        {[cliente.email, cliente.telefone].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                  </Link>
                ))}
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
