import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import {
  podeVerMeuNegocio,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { buscarItensReajustaveis } from "@/lib/catalogo-reajuste-db";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { ReajusteForm } from "./ReajusteForm";

// Exige EDITAR (não só ver) — a tela inteira é uma ferramenta de mudança de
// preço, não tem nada útil pra mostrar em modo leitura.
export default async function ReajusteEmLotePage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CATALOGO"))) {
    redirect("/catalogo");
  }

  // Sem filtro de categoria: pega todos os itens elegíveis só pra listar as
  // categorias que realmente têm produto ajustável (evita categoria vazia
  // no seletor).
  const itens = await buscarItensReajustaveis(usuario.graficaId, null);
  const categorias = [...new Set(itens.map((i) => i.itemCatalogo.categoria))].sort();

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/catalogo"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/catalogo"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao catálogo
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Reajuste de preços em lote
          </h1>
          <p className="mt-1 text-slate-500">
            Aumente ou diminua o preço de vários produtos de uma vez.{" "}
            <strong className="text-slate-700 dark:text-slate-300">
              Só afeta produtos com cálculo Simples
            </strong>{" "}
            — produtos com cálculo M2 ou Offset têm o preço calculado a
            partir de custo e margem, então mudam configurando isso em
            Configurações, não aqui.
          </p>
        </div>

        <ReajusteForm categorias={categorias} totalItensSemFiltro={itens.length} />
      </main>
    </div>
  );
}
