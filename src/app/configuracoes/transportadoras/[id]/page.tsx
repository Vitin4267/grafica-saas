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
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { formatoMoeda } from "@/lib/moeda";
import { formatoInstanteRealComHora } from "@/lib/data";
import { TransportadoraForm } from "./TransportadoraForm";

const LIMITE_ORCAMENTOS_RECENTES = 10;

export default async function TransportadoraDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CONFIGURACOES");

  const transportadora = await prisma.transportadora.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });

  if (!transportadora) {
    notFound();
  }

  // Últimos orçamentos que escolheram esta transportadora (achado F3) —
  // mesmo papel de "compras recentes" em fornecedores/[id]/page.tsx, aqui
  // olhando pro lado de Orcamento.transportadoraId em vez de
  // MovimentacaoEstoque.fornecedorId.
  const orcamentos = await prisma.orcamento.findMany({
    where: { transportadoraId: transportadora.id, graficaId: usuario.graficaId },
    orderBy: { createdAt: "desc" },
    take: LIMITE_ORCAMENTOS_RECENTES,
    select: {
      id: true,
      createdAt: true,
      valorFrete: true,
      cliente: { select: { nome: true } },
    },
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
          href="/configuracoes/transportadoras"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar às transportadoras
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {transportadora.nome}
          </h1>
          <p className="mt-1 text-slate-500">
            Edite o nome/contato ou desative esta transportadora.
          </p>
        </div>

        <TransportadoraForm
          transportadoraId={transportadora.id}
          nome={transportadora.nome}
          telefone={transportadora.telefone ?? ""}
          email={transportadora.email ?? ""}
          documento={transportadora.documento ?? ""}
          rntrc={transportadora.rntrc ?? ""}
          ativa={transportadora.ativa}
        />

        <Card className="mt-6 flex flex-col gap-1 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Orçamentos recentes
          </h2>
          <p className="mb-3 text-sm text-slate-500">
            Últimos {LIMITE_ORCAMENTOS_RECENTES} orçamentos que escolheram esta transportadora,
            mais recente primeiro.
          </p>
          {orcamentos.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Nenhum orçamento usou esta transportadora ainda.
            </p>
          ) : (
            <div className="-mx-6 divide-y divide-slate-100 dark:divide-slate-800">
              {orcamentos.map((orcamento) => (
                <Link
                  key={orcamento.id}
                  href={`/orcamento/${orcamento.id}`}
                  className="flex items-start justify-between gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div>
                    <p className="text-sm text-slate-900 dark:text-white">{orcamento.cliente.nome}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatoInstanteRealComHora.format(orcamento.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {orcamento.valorFrete ? formatoMoeda.format(Number(orcamento.valorFrete)) : "—"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
