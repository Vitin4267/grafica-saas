import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { garantirCategoriasCustoPadrao } from "@/lib/custo-pedido";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { NovaCategoriaCustoForm } from "./NovaCategoriaCustoForm";
import { CategoriaCustoOrdemBotoes } from "./CategoriaCustoOrdemBotoes";

// Achado A2 da Parte 4 da auditoria de abrangência (2026-09-05) — rótulo
// amigável do enum NaturezaCusto pra exibição na lista.
const ROTULO_NATUREZA: Record<"VARIAVEL" | "FIXO" | "SEMIVARIAVEL", string> = {
  VARIAVEL: "Variável",
  FIXO: "Fixo",
  SEMIVARIAVEL: "Semivariável",
};

export default async function CategoriasCustoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  // Idempotente: só cria as 8 sugestões (papel, ferramental, laminação...)
  // se a gráfica ainda não tem NENHUMA categoria — assim toda gráfica
  // nova/existente já vê algo pronto na primeira visita a esta tela, sem
  // exigir setup manual (ver comentário em src/lib/custo-pedido.ts).
  await garantirCategoriasCustoPadrao(usuario.graficaId);

  const categorias = await prisma.categoriaCusto.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: { ordem: "asc" },
  });
  const idsOrdenados = categorias.map((categoria) => categoria.id);

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
          href="/configuracoes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar a Configurações
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Categorias de custo
          </h1>
          <p className="mt-1 text-slate-500">
            As categorias que aparecem pra escolher ao lançar um custo real
            num pedido, em Produção. Vieram 8 sugestões prontas (papel,
            ferramental, laminação...), mas você pode renomear, desativar ou
            criar as suas.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-2">
          {categorias.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhuma categoria cadastrada ainda — crie a primeira abaixo.
              </p>
            </Card>
          )}
          {categorias.map((categoria, indice) => {
            const idsSubir =
              indice > 0
                ? [
                    ...idsOrdenados.slice(0, indice - 1),
                    idsOrdenados[indice],
                    idsOrdenados[indice - 1],
                    ...idsOrdenados.slice(indice + 1),
                  ]
                : null;
            const idsDescer =
              indice < idsOrdenados.length - 1
                ? [
                    ...idsOrdenados.slice(0, indice),
                    idsOrdenados[indice + 1],
                    idsOrdenados[indice],
                    ...idsOrdenados.slice(indice + 2),
                  ]
                : null;

            return (
              <div key={categoria.id} className="flex items-center gap-2">
                {podeEditar && (
                  <CategoriaCustoOrdemBotoes idsSubir={idsSubir} idsDescer={idsDescer} />
                )}
                <Link href={`/configuracoes/categorias-custo/${categoria.id}`} className="flex-1">
                  <Card className="flex items-center justify-between p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <p className="font-medium text-slate-900 dark:text-white">
                      {categoria.nome}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {ROTULO_NATUREZA[categoria.natureza]}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          categoria.ativa
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {categoria.ativa ? "Ativa" : "Inativa"}
                      </span>
                    </div>
                  </Card>
                </Link>
              </div>
            );
          })}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Nova categoria
            </h2>
            <NovaCategoriaCustoForm />
          </Card>
        )}
      </main>
    </div>
  );
}
