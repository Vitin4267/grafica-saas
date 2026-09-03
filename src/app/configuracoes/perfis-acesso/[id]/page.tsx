import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { exigirPapel, podeVerMeuNegocio, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { PerfilAcessoForm } from "./PerfilAcessoForm";

export default async function PerfilAcessoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  exigirPapel(usuario, ["DONO"]);

  const [perfil, usuariosComEstePerfil] = await Promise.all([
    prisma.perfilAcesso.findFirst({
      where: { id, graficaId: usuario.graficaId },
      include: { permissoes: true },
    }),
    prisma.usuario.findMany({
      where: { perfilAcessoId: id, graficaId: usuario.graficaId, desativadoEm: null },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  if (!perfil) {
    notFound();
  }

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

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <Link
          href="/configuracoes/perfis-acesso"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos perfis de acesso
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{perfil.nome}</h1>
          <p className="mt-1 text-slate-500">
            Escolha, tela por tela, o que quem tiver este perfil pode ver e
            editar. Uma permissão marcada individualmente pra um usuário (em{" "}
            <Link href="/usuarios" className="underline">
              Usuários
            </Link>
            ) sempre vence o que está aqui.
          </p>
        </div>

        <PerfilAcessoForm
          perfilId={perfil.id}
          nomeInicial={perfil.nome}
          permissoesIniciais={perfil.permissoes.map((p) => ({
            modulo: p.modulo,
            podeVer: p.podeVer,
            podeEditar: p.podeEditar,
          }))}
          usuariosComEstePerfil={usuariosComEstePerfil}
        />
      </main>
    </div>
  );
}
