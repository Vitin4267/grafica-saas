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
import { formatoInstanteReal } from "@/lib/data";
import { formatoMoeda } from "@/lib/moeda";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { ComissaoLinha } from "./ComissaoLinha";

export default async function ComissoesPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");
  const podeEditar = await podeEditarModulo(usuario, "FINANCEIRO");

  const comissoes = await prisma.comissao.findMany({
    where: { graficaId: usuario.graficaId },
    include: { usuario: { select: { nome: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const totalPendente = comissoes
    .filter((c) => c.status === "PENDENTE")
    .reduce((soma, c) => soma + Number(c.valorComissao), 0);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/financeiro"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/financeiro"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao Financeiro
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Comissões</h1>
          <p className="mt-1 text-slate-500">
            Geradas automaticamente quando um orçamento com vendedor é
            aprovado. Taxa por pessoa e base de cálculo em Usuários e
            Configurações.
          </p>
        </div>

        {totalPendente > 0 && (
          <Card className="mb-6 flex items-center justify-between p-5">
            <p className="text-sm text-slate-500">Total pendente de pagamento</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">
              {formatoMoeda.format(totalPendente)}
            </p>
          </Card>
        )}

        <div className="flex flex-col gap-3">
          {comissoes.length === 0 && (
            <Card className="p-6 text-center text-sm text-slate-500">
              Nenhuma comissão gerada ainda — aprove um orçamento de um
              vendedor com taxa cadastrada em Usuários.
            </Card>
          )}
          {comissoes.map((c) => (
            <ComissaoLinha
              key={c.id}
              comissaoId={c.id}
              vendedorNome={c.usuario.nome}
              orcamentoId={c.orcamentoId}
              baseCalculo={c.baseCalculo}
              percentualAplicado={c.percentualAplicado.toString()}
              valorComissao={c.valorComissao.toString()}
              status={c.status}
              pagoEm={c.pagoEm ? formatoInstanteReal.format(c.pagoEm) : null}
              podeEditar={podeEditar}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
