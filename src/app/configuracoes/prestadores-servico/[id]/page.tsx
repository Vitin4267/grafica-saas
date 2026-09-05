import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { PrestadorServicoForm } from "./PrestadorServicoForm";

export default async function PrestadorServicoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");

  const prestador = await prisma.prestadorServico.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });

  if (!prestador) {
    notFound();
  }

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
          href="/configuracoes/prestadores-servico"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos prestadores de serviço
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{prestador.nome}</h1>
          <p className="mt-1 text-slate-500">
            Edite os dados ou desative este prestador de serviço.
          </p>
        </div>

        <PrestadorServicoForm
          prestadorServicoId={prestador.id}
          valoresIniciais={{
            nome: prestador.nome,
            tipo: prestador.tipo,
            tipoOutro: prestador.tipoOutro,
            documento: prestador.documento,
            telefone: prestador.telefone,
            email: prestador.email,
            observacoes: prestador.observacoes,
            ativo: prestador.ativo,
          }}
        />
      </main>
    </div>
  );
}
