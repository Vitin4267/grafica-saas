import Link from "next/link";
import { notFound } from "next/navigation";
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
import { formatoMoeda } from "@/lib/moeda";
import { formatoInstanteRealComHora } from "@/lib/data";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { LancarMovimentacaoContaPrepagaForm } from "./LancarMovimentacaoContaPrepagaForm";

// Mesmo limiar da listagem (src/app/financeiro/contas-prepagas/page.tsx) —
// só aviso visual, nunca uma trava sobre o lançamento de débito.
const LIMIAR_SALDO_BAIXO = 50;

export default async function ContaPrepagaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");
  const podeEditar = await podeEditarModulo(usuario, "FINANCEIRO");

  const conta = await prisma.contaPrepaga.findFirst({
    where: { id, graficaId: usuario.graficaId },
  });
  if (!conta) {
    notFound();
  }

  const movimentacoes = await prisma.movimentacaoContaPrepaga.findMany({
    where: { contaId: conta.id },
    orderBy: { createdAt: "desc" },
  });

  // MovimentacaoContaPrepaga.criadoPorId não é uma relação no schema (só um
  // id solto), então "quem lançou" precisa de uma busca separada em lote —
  // mesmo princípio de nunca confiar em nome vindo do client, só que aqui
  // nem existe campo denormalizado (diferente de LogAuditoria.usuarioNome).
  const idsUsuarios = Array.from(
    new Set(
      movimentacoes
        .map((movimentacao) => movimentacao.criadoPorId)
        .filter((idUsuario): idUsuario is string => idUsuario !== null)
    )
  );
  const usuariosQueLancaram =
    idsUsuarios.length > 0
      ? await prisma.usuario.findMany({
          where: { id: { in: idsUsuarios } },
          select: { id: true, nome: true },
        })
      : [];
  const nomePorUsuarioId = new Map(usuariosQueLancaram.map((u) => [u.id, u.nome]));

  const saldo = Number(conta.saldoAtual);
  const saldoBaixo = saldo < LIMIAR_SALDO_BAIXO;

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
          href="/financeiro/contas-prepagas"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar a Contas prepagas
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{conta.nome}</h1>
          <p className="mt-1 text-slate-500">Histórico de recargas e débitos desta conta.</p>
        </div>

        <Card className="mb-8 flex items-center justify-between p-6">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Saldo atual</p>
          <div className="flex items-center gap-2">
            <p
              className={`text-2xl font-bold ${
                saldoBaixo ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white"
              }`}
            >
              {formatoMoeda.format(saldo)}
            </p>
            {saldoBaixo && (
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                Saldo baixo
              </span>
            )}
          </div>
        </Card>

        {podeEditar && (
          <Card className="mb-8 p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Lançar movimentação
            </h2>
            <LancarMovimentacaoContaPrepagaForm contaId={conta.id} />
          </Card>
        )}

        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Histórico</h2>
          {movimentacoes.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">Nenhuma movimentação lançada ainda.</p>
            </Card>
          )}
          {movimentacoes.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {movimentacoes.map((movimentacao) => (
                <div key={movimentacao.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {movimentacao.tipo === "RECARGA" ? "Recarga" : "Débito"}
                      {movimentacao.motivo && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          {movimentacao.motivo}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatoInstanteRealComHora.format(movimentacao.createdAt)}
                      {movimentacao.criadoPorId &&
                        ` · ${nomePorUsuarioId.get(movimentacao.criadoPorId) ?? "usuário removido"}`}
                    </p>
                  </div>
                  <p
                    className={`font-semibold ${
                      movimentacao.tipo === "RECARGA"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {movimentacao.tipo === "RECARGA" ? "+ " : "− "}
                    {formatoMoeda.format(Number(movimentacao.valor))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
