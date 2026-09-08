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
import { rotuloTipoColaborador } from "@/lib/tipos-colaborador";
import { NovoColaboradorForm } from "./NovoColaboradorForm";

// Achado D1 da auditoria de abrangência (Parte 4/Qualidade-pessoas,
// pesquisa-abrangencia-modulos.md, "Sem conceito de 'colaborador sem
// login'") — mesma estrutura de /configuracoes/transportadoras e
// /configuracoes/prestadores-servico.
export default async function ColaboradoresPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const colaboradores = await prisma.colaborador.findMany({
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Colaboradores</h1>
          <p className="mt-1 text-slate-500">
            Motorista terceirizado, operador de chão de fábrica — gente que
            você precisa referenciar por nome mas que nunca loga no sistema.
            Diferente de Usuário: sem e-mail, sem senha, sem acesso a nenhuma
            tela. Aparece como opção ao preencher o motorista de uma entrega.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-2">
          {colaboradores.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhum colaborador cadastrado ainda — crie o primeiro abaixo.
              </p>
            </Card>
          )}
          {colaboradores.map((colaborador) => (
            <Link key={colaborador.id} href={`/configuracoes/colaboradores/${colaborador.id}`}>
              <Card className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {colaborador.nome}
                    <span className="ml-2 font-normal text-slate-500">
                      {rotuloTipoColaborador(colaborador.tipo, colaborador.tipoOutro)}
                    </span>
                  </p>
                  {colaborador.telefone && (
                    <p className="mt-0.5 text-xs text-slate-500">{colaborador.telefone}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    colaborador.ativo
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {colaborador.ativo ? "Ativo" : "Inativo"}
                </span>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Novo colaborador
            </h2>
            <NovoColaboradorForm />
          </Card>
        )}
      </main>
    </div>
  );
}
