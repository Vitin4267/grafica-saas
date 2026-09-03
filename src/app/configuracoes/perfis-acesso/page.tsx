import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { exigirPapel, podeVerMeuNegocio, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { NovoPerfilForm } from "./NovoPerfilForm";

export default async function PerfisAcessoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  // Mesmo gate de /usuarios e /usuarios/[id]/permissoes — quem define acesso
  // de outra pessoa é sempre o DONO (ver comentário em actions.ts).
  exigirPapel(usuario, ["DONO"]);

  const perfis = await prisma.perfilAcesso.findMany({
    where: { graficaId: usuario.graficaId },
    include: { _count: { select: { usuarios: true, permissoes: true } } },
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
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/usuarios"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos usuários
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Perfis de acesso</h1>
          <p className="mt-1 text-slate-500">
            Monte um conjunto de permissões reutilizável (ex: &quot;Impressor&quot;,
            &quot;Acabamento&quot;) e atribua a quantos Operadores quiser em
            Usuários, em vez de configurar módulo por módulo pra cada pessoa.
            Uma permissão marcada individualmente pra um usuário sempre vence
            o perfil dele.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-2">
          {perfis.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhum perfil criado ainda — crie o primeiro abaixo.
              </p>
            </Card>
          )}
          {perfis.map((perfil) => (
            <Link key={perfil.id} href={`/configuracoes/perfis-acesso/${perfil.id}`}>
              <Card className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{perfil.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {perfil._count.permissoes} módulo(s) configurado(s) ·{" "}
                    {perfil._count.usuarios} usuário(s) com este perfil
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <Card className="p-6">
          <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
            Novo perfil
          </h2>
          <NovoPerfilForm />
        </Card>
      </main>
    </div>
  );
}
