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
import { FerramentalForm } from "./FerramentalForm";

export default async function FerramentalDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");

  const [ferramental, clientes, itensGrafica] = await Promise.all([
    prisma.ferramental.findFirst({
      where: { id, graficaId: usuario.graficaId },
    }),
    prisma.cliente.findMany({
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    prisma.itemGrafica.findMany({
      where: { graficaId: usuario.graficaId, ativo: true, itemCatalogo: { tipo: "PRODUTO" } },
      include: { itemCatalogo: { select: { nome: true } } },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
  ]);

  if (!ferramental) {
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
          href="/configuracoes/ferramentais"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar aos ferramentais
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{ferramental.codigo}</h1>
          <p className="mt-1 text-slate-500">
            Cadastro informativo — nunca muda preço de nenhum orçamento automaticamente.
          </p>
        </div>

        <FerramentalForm
          ferramentalId={ferramental.id}
          valoresIniciais={{
            codigo: ferramental.codigo,
            tipo: ferramental.tipo,
            tipoOutro: ferramental.tipoOutro,
            descricao: ferramental.descricao,
            proprietario: ferramental.proprietario,
            clienteId: ferramental.clienteId,
            itemGraficaId: ferramental.itemGraficaId,
            localizacao: ferramental.localizacao,
            status: ferramental.status,
            tiragensAcumuladas: ferramental.tiragensAcumuladas,
            desativadoEm: ferramental.desativadoEm,
          }}
          clientes={clientes}
          itensGrafica={itensGrafica.map((item) => ({ id: item.id, nome: item.itemCatalogo.nome }))}
        />
      </main>
    </div>
  );
}
