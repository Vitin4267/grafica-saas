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
import { NovaTransportadoraForm } from "./NovaTransportadoraForm";

// Achado F3 da auditoria de abrangência (Parte 7/Documento e transação) —
// mesma estrutura de /configuracoes/fornecedores.
export default async function TransportadorasPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");
  const podeEditar = await podeEditarModulo(usuario, "CONFIGURACOES");

  const transportadoras = await prisma.transportadora.findMany({
    where: { graficaId: usuario.graficaId },
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
            Transportadoras
          </h1>
          <p className="mt-1 text-slate-500">
            Quem leva a entrega — aparece como opção ao preencher o frete de um
            orçamento e na entrega do pedido. Não é um cadastro de cotação de
            frete, só &quot;quem vai levar&quot;.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-2">
          {transportadoras.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhuma transportadora cadastrada ainda — crie a primeira abaixo.
              </p>
            </Card>
          )}
          {transportadoras.map((transportadora) => (
            <Link key={transportadora.id} href={`/configuracoes/transportadoras/${transportadora.id}`}>
              <Card className="flex items-center justify-between p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {transportadora.nome}
                  </p>
                  {transportadora.telefone && (
                    <p className="mt-0.5 text-xs text-slate-500">{transportadora.telefone}</p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    transportadora.ativa
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {transportadora.ativa ? "Ativa" : "Inativa"}
                </span>
              </Card>
            </Link>
          ))}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Nova transportadora
            </h2>
            <NovaTransportadoraForm />
          </Card>
        )}
      </main>
    </div>
  );
}
