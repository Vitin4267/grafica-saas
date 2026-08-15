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
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { NovaContaPrepagaForm } from "./NovaContaPrepagaForm";

// Abaixo deste valor o saldo aparece em destaque (vermelho) na listagem —
// só um aviso visual pra gráfica saber que está perto de precisar
// recarregar, não uma trava (ver actions.ts: DEBITO nunca é bloqueado por
// causa do saldo). Fixo por enquanto, não virou configuração por gráfica
// pra não adicionar mais uma tela de config numa feature deste tamanho.
const LIMIAR_SALDO_BAIXO = 50;

export default async function ContasPrepagasPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");
  const podeEditar = await podeEditarModulo(usuario, "FINANCEIRO");

  const contas = await prisma.contaPrepaga.findMany({
    where: { graficaId: usuario.graficaId, ativa: true },
    orderBy: { nome: "asc" },
  });

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
            Contas prepagas
          </h1>
          <p className="mt-1 text-slate-500">
            Saldo tipo &quot;vale&quot; de serviços prepagos — ex: uma conta Lalamove que você
            recarrega de tempos em tempos e vai debitando a cada corrida. Diferente do custo de
            frete lançado num pedido: aqui é só o controle do saldo da carteira.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-3">
          {contas.length === 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">
                Nenhuma conta prepaga cadastrada ainda — crie a primeira abaixo.
              </p>
            </Card>
          )}
          {contas.map((conta) => {
            const saldo = Number(conta.saldoAtual);
            const saldoBaixo = saldo < LIMIAR_SALDO_BAIXO;
            return (
              <Link key={conta.id} href={`/financeiro/contas-prepagas/${conta.id}`}>
                <Card className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <p className="font-medium text-slate-900 dark:text-white">{conta.nome}</p>
                  <div className="flex items-center gap-2">
                    <p
                      className={`font-semibold ${
                        saldoBaixo
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-slate-900 dark:text-white"
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
              </Link>
            );
          })}
        </div>

        {podeEditar && (
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
              Nova conta prepaga
            </h2>
            <NovaContaPrepagaForm />
          </Card>
        )}
      </main>
    </div>
  );
}
