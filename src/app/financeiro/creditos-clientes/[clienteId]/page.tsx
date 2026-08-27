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
import { saldoCreditoCliente } from "@/lib/credito-cliente";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { LancarMovimentacaoCreditoClienteForm } from "./LancarMovimentacaoCreditoClienteForm";

const ROTULO_TIPO: Record<string, string> = {
  DEPOSITO: "Depósito",
  CONSUMO: "Consumo",
  ESTORNO: "Estorno",
  AJUSTE: "Ajuste",
};

export default async function CreditoClienteDetalhePage({
  params,
}: {
  params: Promise<{ clienteId: string }>;
}) {
  const { clienteId } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");
  const podeEditar = await podeEditarModulo(usuario, "FINANCEIRO");

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, graficaId: usuario.graficaId },
    select: { id: true, nome: true },
  });
  if (!cliente) {
    notFound();
  }

  // null quando este cliente nunca recebeu nenhum depósito adiantado ainda
  // (o caso de sempre) — a tela funciona igual, só sem histórico, e o
  // registro nasce sozinho no primeiro lançamento (ver actions.ts).
  const credito = await prisma.creditoCliente.findUnique({ where: { clienteId: cliente.id } });

  const movimentacoes = credito
    ? await prisma.movimentacaoCreditoCliente.findMany({
        where: { creditoClienteId: credito.id },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const saldo = credito ? await saldoCreditoCliente(prisma, credito.id) : null;

  const idsUsuarios = Array.from(
    new Set(
      movimentacoes
        .map((m) => m.criadoPorId)
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

  const saldoNumero = saldo ? Number(saldo) : 0;

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
          href="/financeiro/creditos-clientes"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar a Créditos de clientes
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{cliente.nome}</h1>
          <p className="mt-1 text-slate-500">Histórico de depósitos e consumos do crédito adiantado deste cliente.</p>
        </div>

        <Card className="mb-8 flex items-center justify-between p-6">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Saldo atual</p>
          <p
            className={`text-2xl font-bold ${
              saldoNumero > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"
            }`}
          >
            {formatoMoeda.format(saldoNumero)}
          </p>
        </Card>

        {podeEditar && (
          <Card className="mb-8 p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Lançar movimentação
            </h2>
            <LancarMovimentacaoCreditoClienteForm clienteId={cliente.id} />
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
              {movimentacoes.map((movimentacao) => {
                const valorNumero = Number(movimentacao.valor);
                const positivo = movimentacao.tipo === "AJUSTE" ? valorNumero >= 0 : movimentacao.tipo !== "CONSUMO";
                return (
                  <div key={movimentacao.id} className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {ROTULO_TIPO[movimentacao.tipo]}
                        {movimentacao.orcamentoId && (
                          <Link
                            href={`/orcamento/${movimentacao.orcamentoId}`}
                            className="ml-2 text-xs font-normal text-teal-700 hover:underline dark:text-teal-400"
                          >
                            Ver orçamento
                          </Link>
                        )}
                        {movimentacao.descricao && (
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            {movimentacao.descricao}
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
                        positivo
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {positivo ? "+ " : "− "}
                      {formatoMoeda.format(Math.abs(valorNumero))}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
