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
import { garantirCondicoesPagamentoPadrao } from "@/lib/condicao-pagamento";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { NovaCondicaoPagamentoForm } from "./NovaCondicaoPagamentoForm";
import { ROTULO_ANCORA_VENCIMENTO } from "./rotulos";

export default async function CondicoesPagamentoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  // Idempotente: só cria as 4 condições comuns do mercado brasileiro (1x
  // faturado 30 dias; 50%+50% na entrega; 30/60/90 com 2% de acréscimo;
  // 28/42/56 dias da emissão da nota) se a gráfica ainda não tem NENHUMA
  // CondicaoPagamento cadastrada — mesmo princípio de
  // garantirCategoriasCustoPadrao (ver comentário completo em
  // src/lib/condicao-pagamento.ts).
  await garantirCondicoesPagamentoPadrao(usuario.graficaId);

  const condicoes = await prisma.condicaoPagamento.findMany({
    where: { graficaId: usuario.graficaId },
    include: { parcelas: true },
    orderBy: { nome: "asc" },
  });

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
            Condições de pagamento
          </h1>
          <p className="mt-1 text-slate-500">
            O jeito de cobrar que sua gráfica pratica — vincule uma condição a
            um orçamento pra gerar as parcelas de conta a receber
            automaticamente na aprovação, em vez de cadastrar cada parcela à
            mão. Vieram 4 sugestões prontas do mercado, mas você pode
            renomear, desativar ou criar as suas.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-2">
          {condicoes.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhuma condição de pagamento cadastrada ainda — crie a
                primeira abaixo.
              </p>
            </Card>
          )}
          {condicoes.map((condicao) => (
            <Link key={condicao.id} href={`/configuracoes/condicoes-pagamento/${condicao.id}`}>
              <Card className="flex items-center justify-between p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{condicao.nome}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {ROTULO_ANCORA_VENCIMENTO[condicao.ancora] ?? condicao.ancora}
                    {" · "}
                    {condicao.parcelas.length}{" "}
                    parcela{condicao.parcelas.length !== 1 ? "s" : ""}
                    {condicao.acrescimoPercent
                      ? ` · +${Number(condicao.acrescimoPercent)}%`
                      : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    condicao.ativa
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {condicao.ativa ? "Ativa" : "Inativa"}
                </span>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Nova condição
            </h2>
            <NovaCondicaoPagamentoForm />
          </Card>
        )}
      </main>
    </div>
  );
}
