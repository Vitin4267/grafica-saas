import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirPapel, podeVerMeuNegocio } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { PermissoesForm } from "./PermissoesForm";

export default async function PermissoesUsuarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const alvo = await prisma.usuario.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });
  if (!alvo) {
    notFound();
  }

  // DONO e ADMIN têm acesso total automático — essa tela só existe pra
  // configurar OPERADOR. Redireciona de volta em vez de mostrar um formulário
  // que não faria efeito nenhum.
  if (alvo.papel !== "OPERADOR") {
    redirect("/usuarios");
  }

  const permissoesAtuais = await prisma.permissaoUsuario.findMany({
    where: { usuarioId: alvo.id },
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

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <Link
          href="/usuarios"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos usuários
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Permissões de {alvo.nome}
          </h1>
          <p className="mt-1 text-slate-500">
            Escolha, tela por tela, o que essa pessoa pode ver e editar. Por padrão, um
            Operador não vê nenhuma tela até você liberar aqui.
          </p>
        </div>

        <PermissoesForm
          usuarioId={alvo.id}
          permissoesIniciais={permissoesAtuais.map((p) => ({
            modulo: p.modulo,
            podeVer: p.podeVer,
            podeEditar: p.podeEditar,
          }))}
        />
      </main>
    </div>
  );
}
