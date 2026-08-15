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
import { formatoMoeda } from "@/lib/moeda";
import { dataEhPassado } from "@/lib/data";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { ContaReceberLinha } from "./ContaReceberLinha";

export default async function ContasReceberPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");
  const podeEditar = await podeEditarModulo(usuario, "FINANCEIRO");

  // Ordem: PENDENTE antes de RECEBIDO antes de CANCELADO (mesma ideia de
  // /financeiro pra Despesa — a ordem do enum já coloca o que precisa de
  // atenção primeiro), e dentro de cada status, vencimento mais antigo
  // primeiro — então uma parcela vencida há mais tempo aparece no topo.
  const contas = await prisma.contaReceber.findMany({
    where: { graficaId: usuario.graficaId },
    include: { orcamento: { include: { cliente: { select: { nome: true } } } } },
    orderBy: [{ status: "asc" }, { vencimento: "asc" }],
  });

  const pendentes = contas.filter((c) => c.status === "PENDENTE");
  const vencidas = pendentes.filter((c) => dataEhPassado(c.vencimento));
  const recebidas = contas.filter((c) => c.status === "RECEBIDO");

  const totalPendente = pendentes.reduce((soma, c) => soma + Number(c.valor), 0);
  const totalVencido = vencidas.reduce((soma, c) => soma + Number(c.valor), 0);
  const totalRecebido = recebidas.reduce((soma, c) => soma + Number(c.valor), 0);

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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Contas a receber
          </h1>
          <p className="mt-1 text-slate-500">
            Parcelas e pagamentos esperados dos orçamentos aprovados — o que ainda
            falta o cliente pagar. Cadastradas na página de cada orçamento.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="p-5">
            <p className="text-xs text-slate-500">Total pendente</p>
            <p className="mt-1 text-xl font-bold text-amber-600 dark:text-amber-400">
              {formatoMoeda.format(totalPendente)}
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-xs text-slate-500">Total vencido</p>
            <p className="mt-1 text-xl font-bold text-rose-600 dark:text-rose-400">
              {formatoMoeda.format(totalVencido)}
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-xs text-slate-500">Total recebido</p>
            <p className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatoMoeda.format(totalRecebido)}
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          {contas.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhuma conta a receber cadastrada ainda — abra um orçamento aprovado
                e cadastre as parcelas esperadas por lá.
              </p>
            </Card>
          )}
          {contas.map((conta) => (
            <ContaReceberLinha
              key={conta.id}
              podeEditar={podeEditar}
              conta={{
                id: conta.id,
                descricao: conta.descricao,
                valor: conta.valor.toString(),
                vencimento: conta.vencimento.toISOString(),
                status: conta.status,
                recebidoEm: conta.recebidoEm ? conta.recebidoEm.toISOString() : null,
                orcamentoId: conta.orcamentoId,
                clienteNome: conta.orcamento.cliente.nome,
              }}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
