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
import { MaquinaSetupPorPecaForm } from "./MaquinaSetupPorPecaForm";

export default async function MaquinaSetupPorPecaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");

  const maquina = await prisma.maquinaSetupPorPeca.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });

  if (!maquina) {
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
          href="/configuracoes/maquinas"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar às máquinas
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {maquina.nome}
          </h1>
          <p className="mt-1 text-slate-500">
            Esses valores afetam todos os produtos de Serigrafia/Sublimação/
            Estampagem a quente que usam esta máquina.
          </p>
        </div>

        <MaquinaSetupPorPecaForm
          maquinaId={maquina.id}
          valoresIniciais={{
            nome: maquina.nome,
            ativa: maquina.ativa,
            tipoProcesso: maquina.tipoProcesso,
            custoPorSetup: maquina.custoPorSetup.toString(),
            custoPorPeca: maquina.custoPorPeca.toString(),
            custoMinimo: maquina.custoMinimo.toString(),
          }}
        />
      </main>
    </div>
  );
}
