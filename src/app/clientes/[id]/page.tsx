import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { ClienteEditForm } from "./ClienteEditForm";

export default async function ClienteDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CLIENTES");
  const podeEditar = await podeEditarModulo(usuario, "CLIENTES");

  const cliente = await prisma.cliente.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });

  if (!cliente) {
    notFound();
  }

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

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <Link
          href="/clientes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos clientes
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{cliente.nome}</h1>
          <p className="mt-1 text-slate-500">
            O endereço é usado pra emitir nota fiscal — preencha antes de
            aprovar um orçamento pra esse cliente se for emitir nota.
          </p>
        </div>

        <ClienteEditForm
          clienteId={cliente.id}
          podeEditar={podeEditar}
          valoresIniciais={{
            nome: cliente.nome,
            email: cliente.email ?? "",
            telefone: cliente.telefone ?? "",
            documento: cliente.documento ?? "",
            enderecoCep: cliente.enderecoCep ?? "",
            enderecoLogradouro: cliente.enderecoLogradouro ?? "",
            enderecoNumero: cliente.enderecoNumero ?? "",
            enderecoComplemento: cliente.enderecoComplemento ?? "",
            enderecoBairro: cliente.enderecoBairro ?? "",
            enderecoMunicipio: cliente.enderecoMunicipio ?? "",
            enderecoCodigoIbge: cliente.enderecoCodigoIbge ?? "",
            enderecoUf: cliente.enderecoUf ?? "",
          }}
        />
      </main>
    </div>
  );
}
