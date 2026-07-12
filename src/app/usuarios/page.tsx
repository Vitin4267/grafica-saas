import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirPapel, podeVerMeuNegocio } from "@/lib/auth/permissoes";
import { ROTULO_PAPEL } from "@/lib/papel-usuario";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { UsersIcon } from "@/components/icons";
import { UsuarioForm } from "./UsuarioForm";
import { AcessoMeuNegocioForm } from "./AcessoMeuNegocioForm";

export default async function UsuariosPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const usuarios = await prisma.usuario.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: { nome: "asc" },
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/usuarios"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Usuários</h1>
          <p className="mt-1 text-slate-500">
            Dê acesso ao sistema pra sua equipe. Cada pessoa entra com o
            próprio e-mail e senha.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
          <Card className="p-6 lg:col-span-2">
            <h2 className="mb-5 text-base font-semibold text-slate-900 dark:text-white">
              Novo usuário
            </h2>
            <UsuarioForm />
          </Card>

          <div className="lg:col-span-3">
            <Card className="divide-y divide-slate-100 dark:divide-slate-800">
              {usuarios.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                      <UsersIcon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{u.nome}</p>
                      <p className="text-sm text-slate-500">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {ROTULO_PAPEL[u.papel] ?? u.papel}
                    </span>
                    {u.papel === "OPERADOR" ? (
                      <Link
                        href={`/usuarios/${u.id}/permissoes`}
                        className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
                      >
                        Permissões
                      </Link>
                    ) : u.papel === "ADMIN" ? (
                      <span className="text-xs text-slate-400">Acesso total</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </div>

        <section className="mt-12">
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
            Acesso ao relatório Meu Negócio
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Por padrão, só você (dono) vê a visão geral do negócio. Compartilhe
            com a equipe e escolha quem tem acesso.
          </p>
          <AcessoMeuNegocioForm
            compartilhar={usuario.grafica.compartilharMeuNegocio}
            funcionarios={usuarios
              .filter((u) => u.papel !== "DONO")
              .map((u) => ({
                id: u.id,
                nome: u.nome,
                email: u.email,
                papel: u.papel,
                acesso: u.acessoMeuNegocio,
              }))}
          />
        </section>
      </main>
    </div>
  );
}
