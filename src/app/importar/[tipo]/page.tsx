import { notFound, redirect } from "next/navigation";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, podeEditarModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { CAMPOS_CLIENTES, CAMPOS_CATALOGO, CAMPOS_PEDIDOS } from "@/lib/importacao/campos";
import type { TipoImportacaoPlanilha, ModuloPermissao } from "@/generated/prisma/enums";
import { ImportadorWizard } from "./ImportadorWizard";

const TIPO_POR_SLUG: Record<string, TipoImportacaoPlanilha> = {
  clientes: "CLIENTES",
  catalogo: "CATALOGO",
  pedidos: "PEDIDOS",
};

const MODULO_DO_TIPO: Record<TipoImportacaoPlanilha, ModuloPermissao> = {
  CLIENTES: "CLIENTES",
  CATALOGO: "CATALOGO",
  PEDIDOS: "ORCAMENTO",
};

const TITULO_DO_TIPO: Record<TipoImportacaoPlanilha, string> = {
  CLIENTES: "Importar clientes",
  CATALOGO: "Importar catálogo",
  PEDIDOS: "Importar pedidos históricos",
};

const CAMPOS_DO_TIPO = {
  CLIENTES: CAMPOS_CLIENTES,
  CATALOGO: CAMPOS_CATALOGO,
  PEDIDOS: CAMPOS_PEDIDOS,
};

export default async function ImportarTipoPage({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo: slug } = await params;
  const tipo = TIPO_POR_SLUG[slug];
  if (!tipo) {
    notFound();
  }

  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const podeEditar = await podeEditarModulo(usuario, MODULO_DO_TIPO[tipo]);
  if (!podeEditar) {
    redirect("/importar");
  }

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/importar"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{TITULO_DO_TIPO[tipo]}</h1>
          <p className="mt-1 text-slate-500">
            Envie um arquivo .xlsx ou .csv — a IA sugere o mapeamento de coluna,
            você confirma antes de qualquer coisa ser gravada.
          </p>
        </div>

        <ImportadorWizard tipo={tipo} campos={CAMPOS_DO_TIPO[tipo]} />
      </main>
    </div>
  );
}
