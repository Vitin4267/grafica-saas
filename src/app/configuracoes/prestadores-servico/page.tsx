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
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { rotuloTipoPrestadorServico } from "@/lib/tipos-prestador-servico";
import { NovoPrestadorServicoForm } from "./NovoPrestadorServicoForm";

export default async function PrestadoresServicoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const prestadores = await prisma.prestadorServico.findMany({
    where: { graficaId: usuario.graficaId },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
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
            Prestadores de serviço
          </h1>
          <p className="mt-1 text-slate-500">
            Acabamento terceirizado (laminação, encadernação...), logística/
            despachante e freelancer de design — diferente de Fornecedor, que
            é só pra compra de material. Cadastro de referência: por enquanto
            não muda nenhum cálculo nem lançamento, é só pra saber quem
            presta cada serviço.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-2">
          {prestadores.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhum prestador de serviço cadastrado ainda — crie o primeiro abaixo.
              </p>
            </Card>
          )}
          {prestadores.map((prestador) => (
            <Link
              key={prestador.id}
              href={`/configuracoes/prestadores-servico/${prestador.id}`}
            >
              <Card className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {prestador.nome}
                    <span className="ml-2 font-normal text-slate-500">
                      {rotuloTipoPrestadorServico(prestador.tipo, prestador.tipoOutro)}
                    </span>
                  </p>
                  {(prestador.telefone || prestador.email) && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[prestador.telefone, prestador.email].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    prestador.ativo
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {prestador.ativo ? "Ativo" : "Inativo"}
                </span>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Novo prestador de serviço
            </h2>
            <NovoPrestadorServicoForm />
          </Card>
        )}
      </main>
    </div>
  );
}
